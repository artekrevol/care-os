import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  messageThreadsTable,
  messagesTable,
  caregiversTable,
  visitsTable,
  schedulesTable,
  clientsTable,
} from "@workspace/db";
import { AGENCY_ID } from "../../lib/agency";
import { newId } from "../../lib/ids";
import { recordAudit } from "../../lib/audit";
import { dispatchNotificationToUsers } from "../../lib/notify";
import { realtime } from "@workspace/services";
import {
  requireCaregiverSession,
  loadCaregiver,
  type MAuthedRequest,
} from "./middleware";

const router: IRouter = Router();

type Participant = { userId: string; role: string; name: string };

/** Roles a caregiver is allowed to converse with via the mobile PWA. The
 * product boundary is explicit: caregivers talk to agency coordinators only.
 * Family / client / external roles are blocked at the API layer so the mobile
 * surface can never be used as a side-channel to family members. */
const ALLOWED_PEER_ROLES = new Set(["AGENCY", "COORDINATOR", "ADMIN", "CAREGIVER"]);
const BLOCKED_PEER_ROLES = new Set([
  "FAMILY",
  "CLIENT",
  "GUARDIAN",
  "EMERGENCY_CONTACT",
]);

/** A thread is exposable to the caregiver app only if (a) the caregiver is a
 * participant AND (b) every other participant belongs to an agency-side role
 * (no family / client participants). */
function isCaregiverThreadAllowed(
  thread: typeof messageThreadsTable.$inferSelect,
  caregiverId: string,
  caregiverUserId: string | null,
): boolean {
  const ps = (thread.participants as Participant[] | null) ?? [];
  const caregiverIsParticipant =
    thread.caregiverId === caregiverId ||
    ps.some(
      (p) =>
        p.role === "CAREGIVER" &&
        (p.userId === caregiverUserId || p.userId === caregiverId),
    );
  if (!caregiverIsParticipant) return false;
  // Reject if any participant is a family/client role, regardless of how the
  // thread was created elsewhere in the system.
  for (const p of ps) {
    const role = (p.role ?? "").toUpperCase();
    if (BLOCKED_PEER_ROLES.has(role)) return false;
    if (!ALLOWED_PEER_ROLES.has(role)) return false;
  }
  return true;
}

// Backwards-compatible alias used in the rest of this file.
const isCaregiverParticipant = isCaregiverThreadAllowed;

function formatThread(t: typeof messageThreadsTable.$inferSelect) {
  return {
    id: t.id,
    clientId: t.clientId,
    caregiverId: t.caregiverId,
    topic: t.topic,
    subject: t.subject,
    participants: (t.participants as Participant[] | null) ?? [],
    lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
    closedAt: t.closedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

function formatMessage(m: typeof messagesTable.$inferSelect) {
  return {
    id: m.id,
    threadId: m.threadId,
    authorId: m.authorId,
    authorRole: m.authorRole,
    authorName: m.authorName,
    body: m.body,
    attachments: (m.attachments as unknown[]) ?? [],
    redacted: m.redacted,
    createdAt: m.createdAt.toISOString(),
  };
}

router.get(
  "/m/threads",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const cg = await loadCaregiver(caregiverId);
    const rows = await db
      .select()
      .from(messageThreadsTable)
      .where(eq(messageThreadsTable.agencyId, AGENCY_ID))
      .orderBy(desc(messageThreadsTable.lastMessageAt));
    const filtered = rows.filter((t) =>
      isCaregiverParticipant(t, caregiverId, cg?.userId ?? null),
    );
    // attach client names + visit context
    const clientIds = Array.from(
      new Set(filtered.map((t) => t.clientId).filter(Boolean) as string[]),
    );
    const clients = clientIds.length
      ? await db
          .select()
          .from(clientsTable)
          .where(eq(clientsTable.agencyId, AGENCY_ID))
      : [];
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    res.json({
      threads: filtered.map((t) => ({
        ...formatThread(t),
        clientName: t.clientId
          ? (() => {
              const c = clientMap.get(t.clientId!);
              return c ? `${c.firstName} ${c.lastName}` : null;
            })()
          : null,
      })),
    });
  },
);

router.get(
  "/m/threads/:id/messages",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const cg = await loadCaregiver(caregiverId);
    const [t] = await db
      .select()
      .from(messageThreadsTable)
      .where(
        and(
          eq(messageThreadsTable.agencyId, AGENCY_ID),
          eq(messageThreadsTable.id, req.params.id as string),
        ),
      )
      .limit(1);
    if (!t || !isCaregiverParticipant(t, caregiverId, cg?.userId ?? null)) {
      res.status(404).json({ error: "thread not found" });
      return;
    }
    const rows = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.agencyId, AGENCY_ID),
          eq(messagesTable.threadId, t.id),
        ),
      )
      .orderBy(messagesTable.createdAt);
    res.json({
      thread: formatThread(t),
      messages: rows.map(formatMessage),
    });
  },
);

const MPostMessageBody = z.object({
  body: z.string().min(1),
});

router.post(
  "/m/threads/:id/messages",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = MPostMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const cg = await loadCaregiver(caregiverId);
    if (!cg) {
      res.status(401).json({ error: "caregiver not found" });
      return;
    }
    const [t] = await db
      .select()
      .from(messageThreadsTable)
      .where(
        and(
          eq(messageThreadsTable.agencyId, AGENCY_ID),
          eq(messageThreadsTable.id, req.params.id as string),
        ),
      )
      .limit(1);
    if (!t || !isCaregiverParticipant(t, caregiverId, cg.userId ?? null)) {
      res.status(404).json({ error: "thread not found" });
      return;
    }
    const id = newId("msg");
    const now = new Date();
    const authorName = `${cg.firstName} ${cg.lastName}`;
    const [row] = await db
      .insert(messagesTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        threadId: t.id,
        authorId: cg.userId ?? caregiverId,
        authorRole: "CAREGIVER",
        authorName,
        body: parsed.data.body,
        attachments: [],
        readBy: [cg.userId ?? caregiverId],
      })
      .returning();
    await db
      .update(messageThreadsTable)
      .set({ lastMessageAt: now })
      .where(eq(messageThreadsTable.id, t.id));

    await recordAudit(
      { id: cg.userId ?? caregiverId, name: authorName },
      {
        action: "POST_MESSAGE",
        entityType: "Message",
        entityId: id,
        summary: `Caregiver posted to thread ${t.id}`,
        afterState: { threadId: t.id, length: parsed.data.body.length },
      },
    );

    // Notify other participants (coordinator/agency only — not family↔caregiver direct).
    const ps = (t.participants as Participant[] | null) ?? [];
    const recipients = ps
      .filter((p) => p.role !== "CAREGIVER" && p.role !== "FAMILY")
      .map((p) => ({ userId: p.userId, userRole: p.role }));
    if (recipients.length > 0) {
      try {
        await dispatchNotificationToUsers({
          notificationTypeId: "messaging.new_message",
          recipients,
          payload: {
            subject: `Message from ${authorName}`,
            body: parsed.data.body.slice(0, 140),
            url: `/messaging?thread=${t.id}`,
            threadId: t.id,
          },
        });
      } catch {
        /* ignore */
      }
    }
    // Real-time fan-out (Pusher) for live thread updates; falls through when
    // PUSHER_* env vars are not configured.
    try {
      await realtime.publish(
        `private-thread-${t.id}`,
        "message.created",
        formatMessage(row),
      );
    } catch {
      /* ignore */
    }
    res.status(201).json(formatMessage(row));
  },
);

// Get-or-create the per-shift thread for a visit. Caregiver↔coordinator only.
router.post(
  "/m/visits/:id/thread",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const cg = await loadCaregiver(caregiverId);
    if (!cg) {
      res.status(401).json({ error: "caregiver not found" });
      return;
    }
    const visitId = req.params.id as string;
    const [v] = await db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.agencyId, AGENCY_ID),
          eq(visitsTable.id, visitId),
          eq(visitsTable.caregiverId, caregiverId),
        ),
      )
      .limit(1);
    if (!v) {
      res.status(404).json({ error: "visit not found" });
      return;
    }
    // Look for an existing per-shift thread keyed by topic=VISIT and subject containing visit id.
    const existing = await db
      .select()
      .from(messageThreadsTable)
      .where(
        and(
          eq(messageThreadsTable.agencyId, AGENCY_ID),
          eq(messageThreadsTable.caregiverId, caregiverId),
          eq(messageThreadsTable.clientId, v.clientId),
          eq(messageThreadsTable.topic, "VISIT"),
          eq(messageThreadsTable.subject, `visit:${visitId}`),
        ),
      )
      .limit(1);
    if (existing[0]) {
      res.json(formatThread(existing[0]));
      return;
    }
    const id = newId("thr");
    const participants: Participant[] = [
      {
        userId: cg.userId ?? caregiverId,
        role: "CAREGIVER",
        name: `${cg.firstName} ${cg.lastName}`,
      },
      // Coordinator slot — agency staff. We add a role-only marker; admin UI
      // can reply via the existing /api/message-threads endpoints.
      { userId: "agency:coordinator", role: "AGENCY", name: "Care Coordinator" },
    ];
    const [t] = await db
      .insert(messageThreadsTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        clientId: v.clientId,
        caregiverId,
        topic: "VISIT",
        subject: `visit:${visitId}`,
        participants,
      })
      .returning();
    res.status(201).json(formatThread(t));
  },
);

export default router;
