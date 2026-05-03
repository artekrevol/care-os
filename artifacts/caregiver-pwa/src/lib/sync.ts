import { api, ApiError } from "./api";
import { enqueue, type EnqueueArgs } from "./outbox";
import { db } from "./db";

export type MutateOrQueueArgs = {
  kind: EnqueueArgs["kind"];
  path: string;
  method?: "POST" | "PUT";
  body: Record<string, unknown>;
  visitId?: string;
  /** When set (e.g. "local_..."), the mutation targets an offline-started
   * visit whose server ID isn't known yet. Always queues; the outbox flusher
   * rewrites the path with the real visit id once clock-in syncs. */
  localVisitId?: string;
  scheduleId?: string;
};

export type MutateOrQueueResult<T> =
  | { ok: true; queued: false; data: T }
  | { ok: true; queued: true };

export async function mutateOrQueue<T = unknown>(
  args: MutateOrQueueArgs,
): Promise<MutateOrQueueResult<T>> {
  const occurredAt = new Date().toISOString();
  const clientRequestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const body = { ...args.body, occurredAt, clientRequestId };
  // Local visits are not yet known to the server — always queue.
  const isLocalVisit = !!args.localVisitId;
  if (
    isLocalVisit ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  ) {
    await enqueue({ ...args, body, occurredAt });
    return { ok: true, queued: true };
  }
  try {
    const data = await api<T>(args.path, {
      method: args.method ?? "POST",
      body: JSON.stringify(body),
    });
    return { ok: true, queued: false, data };
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    // Network / 5xx → queue. 4xx → rethrow so caller can show validation error.
    if (status === 0 || status >= 500 || status === 408 || status === 429) {
      await enqueue({ ...args, body, occurredAt });
      return { ok: true, queued: true };
    }
    throw err;
  }
}

/**
 * Session-start prefetch: warms the cache so today + tomorrow's schedule and
 * the active visit detail (with care plan + checklist) are available while
 * offline. Runs best-effort; failures are swallowed.
 */
export async function prefetchSession(): Promise<void> {
  try {
    const sched = await api<unknown>("/m/schedule");
    await db.schedule.put({
      key: "current",
      data: sched,
      fetchedAt: Date.now(),
    });
    const active = await api<{ visit?: { id: string } }>("/m/visits/active");
    if (active.visit) {
      const detail = await api<unknown>(`/m/visits/${active.visit.id}`);
      await db.visits.put({
        visitId: active.visit.id,
        data: detail,
        fetchedAt: Date.now(),
      });
    }
    // Prefetch today's & tomorrow's schedule entries' visit shells if the
    // server has already created them (some flows pre-create the visit row).
    const s = sched as {
      today?: { entries: Array<{ id: string; visitId?: string | null }> };
      upcoming?: Array<{
        date: string;
        entries: Array<{ id: string; visitId?: string | null }>;
      }>;
    };
    const visitIds = new Set<string>();
    s.today?.entries.forEach((e) => {
      if (e.visitId) visitIds.add(e.visitId);
    });
    s.upcoming?.[0]?.entries.forEach((e) => {
      if (e.visitId) visitIds.add(e.visitId);
    });
    await Promise.all(
      Array.from(visitIds).map(async (vid) => {
        try {
          const d = await api<unknown>(`/m/visits/${vid}`);
          await db.visits.put({
            visitId: vid,
            data: d,
            fetchedAt: Date.now(),
          });
        } catch {
          /* ignore */
        }
      }),
    );
  } catch {
    /* offline or auth — skip */
  }
}
