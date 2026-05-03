import { db, type OutboxItem, type OutboxKind } from "./db";
import { api, ApiError } from "./api";

export type EnqueueArgs = {
  kind: OutboxKind;
  path: string;
  method?: "POST" | "PUT";
  body: Record<string, unknown>;
  occurredAt?: string;
  visitId?: string;
  localVisitId?: string;
  scheduleId?: string;
};

let listenerInstalled = false;
const subscribers = new Set<() => void>();

function genId(): string {
  return `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function notify(): void {
  for (const s of subscribers) {
    try {
      s();
    } catch {
      /* ignore */
    }
  }
}

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export async function enqueue(args: EnqueueArgs): Promise<OutboxItem> {
  const occurredAt = args.occurredAt ?? new Date().toISOString();
  const item: OutboxItem = {
    id: genId(),
    kind: args.kind,
    path: args.path,
    method: args.method ?? "POST",
    body: { ...args.body, occurredAt, clientRequestId: genId() },
    occurredAt,
    visitId: args.visitId,
    localVisitId: args.localVisitId,
    scheduleId: args.scheduleId,
    attempts: 0,
    createdAt: Date.now(),
  };
  await db.outbox.put(item);
  notify();
  return item;
}

export async function pending(): Promise<OutboxItem[]> {
  return db.outbox.orderBy("createdAt").toArray();
}

export async function pendingCount(): Promise<number> {
  return db.outbox.count();
}

let flushing = false;

/**
 * Replay queued mutations in createdAt order. Handles offline-started visits:
 * a clock-in queued with a localVisitId returns the real server visit ID,
 * which is then used to rewrite the path of every dependent mutation
 * (checklist/notes/incidents/signature/clock-out) before they're sent.
 */
export async function flush(): Promise<{
  succeeded: number;
  failed: number;
  remaining: number;
}> {
  if (flushing) return { succeeded: 0, failed: 0, remaining: await pendingCount() };
  flushing = true;
  let succeeded = 0;
  let failed = 0;
  try {
    const items = await pending();
    // Hydrate id-map from prior flushes.
    const idMap: Record<string, string> = {};
    for (const m of await db.idMap.toArray()) {
      idMap[m.localId] = m.realId;
    }
    const droppedLocal = new Set<string>();

    for (const item of items) {
      const localId = item.localVisitId;
      // If the parent clock-in was permanently rejected, drop dependent items.
      if (localId && droppedLocal.has(localId)) {
        await db.outbox.delete(item.id);
        notify();
        continue;
      }
      // Dependent mutation whose parent hasn't synced yet — leave queued.
      if (localId && item.kind !== "clock-in" && !idMap[localId]) {
        continue;
      }
      // Rewrite path with mapped real id when needed.
      let path = item.path;
      if (localId && idMap[localId] && path.includes(localId)) {
        path = path.replace(localId, idMap[localId]);
      }
      try {
        const response = await api<unknown>(path, {
          method: item.method,
          body: JSON.stringify(item.body),
        });
        // Capture the real visit id from a clock-in response so dependent items
        // can be rewritten in this same (or future) flush pass.
        if (item.kind === "clock-in" && localId) {
          const realId =
            response && typeof response === "object" && "id" in response
              ? String((response as { id: unknown }).id)
              : null;
          if (realId) {
            idMap[localId] = realId;
            await db.idMap.put({
              localId,
              realId,
              syncedAt: Date.now(),
            });
            await db.visits.put({
              visitId: realId,
              data: response,
              fetchedAt: Date.now(),
            });
          }
        }
        await db.outbox.delete(item.id);
        succeeded += 1;
        notify();
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        const isPermanent =
          status >= 400 && status < 500 && status !== 408 && status !== 429;
        if (isPermanent) {
          await db.outbox.delete(item.id);
          if (item.kind === "clock-in" && localId) {
            // Parent rejected — orphan all of its dependents.
            droppedLocal.add(localId);
          }
          failed += 1;
        } else {
          await db.outbox.update(item.id, {
            attempts: item.attempts + 1,
            lastError: err instanceof Error ? err.message : String(err),
          });
          failed += 1;
          // Block subsequent dependents of this same parent on a transient
          // failure so we don't waste retries this pass.
          if (item.kind === "clock-in" && localId) {
            droppedLocal.add(localId);
            // But unmark so they remain queued, not deleted.
            droppedLocal.delete(localId);
            break;
          }
        }
        notify();
      }
    }
  } finally {
    flushing = false;
  }
  return { succeeded, failed, remaining: await pendingCount() };
}

export function installAutoFlush(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener("online", () => {
    void flush();
  });
  // Periodic retry while online (handles backend-down recovery).
  setInterval(() => {
    if (navigator.onLine) void flush();
  }, 30_000);
  // Initial attempt on load.
  if (navigator.onLine) void flush();
}
