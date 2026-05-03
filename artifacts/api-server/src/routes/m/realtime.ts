import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, messageThreadsTable } from "@workspace/db";
import { realtime } from "@workspace/services";
import { AGENCY_ID } from "../../lib/agency";
import {
  requireCaregiverSession,
  loadCaregiver,
  type MAuthedRequest,
} from "./middleware";

const router: IRouter = Router();

router.get(
  "/m/realtime/credentials",
  requireCaregiverSession,
  async (_req, res): Promise<void> => {
    const creds = realtime.getClientCredentials();
    // Tell the client where to authorize private channel subscriptions.
    res.json({
      credentials: creds,
      authEndpoint: creds ? "/api/m/realtime/auth" : null,
    });
  },
);

const AuthBody = z.object({
  socket_id: z.string().min(1),
  channel_name: z.string().min(1),
});

type Participant = { userId: string; role: string; name: string };
const ALLOWED_PEER_ROLES = new Set([
  "AGENCY",
  "COORDINATOR",
  "ADMIN",
  "CAREGIVER",
]);
const BLOCKED_PEER_ROLES = new Set([
  "FAMILY",
  "CLIENT",
  "GUARDIAN",
  "EMERGENCY_CONTACT",
]);

/**
 * Pusher private-channel authorization. Pusher posts {socket_id, channel_name}
 * here when the client subscribes; we MUST verify the caregiver is a member
 * of the requested thread before signing — otherwise any authenticated
 * caregiver could subscribe to any thread channel and read message payloads.
 */
router.post(
  "/m/realtime/auth",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    // Pusher posts as application/x-www-form-urlencoded — Express's urlencoded
    // middleware (mounted in api-server) handles parsing.
    const parsed = AuthBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const channel = parsed.data.channel_name;
    if (!channel.startsWith("private-thread-")) {
      // Caregivers can only subscribe to per-thread private channels via mobile.
      res.status(403).json({ error: "channel not allowed" });
      return;
    }
    const threadId = channel.slice("private-thread-".length);
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
          eq(messageThreadsTable.id, threadId),
        ),
      )
      .limit(1);
    if (!t) {
      res.status(404).json({ error: "thread not found" });
      return;
    }
    // Membership: caregiver must be linked to the thread AND no family/client
    // participants — same boundary the read/post routes enforce.
    const ps = (t.participants as Participant[] | null) ?? [];
    const isMember =
      t.caregiverId === caregiverId ||
      ps.some(
        (p) =>
          p.role === "CAREGIVER" &&
          (p.userId === cg.userId || p.userId === caregiverId),
      );
    if (!isMember) {
      res.status(403).json({ error: "not a thread member" });
      return;
    }
    for (const p of ps) {
      const role = (p.role ?? "").toUpperCase();
      if (BLOCKED_PEER_ROLES.has(role) || !ALLOWED_PEER_ROLES.has(role)) {
        res.status(403).json({ error: "channel not allowed" });
        return;
      }
    }
    const signed = realtime.authorizeChannel(
      parsed.data.socket_id,
      `private-thread-${threadId}`,
    );
    if (!signed) {
      // Realtime not configured — should not reach here because /credentials
      // returns null in dev and the client wouldn't subscribe. Reject anyway.
      res.status(503).json({ error: "realtime not configured" });
      return;
    }
    res.json(signed);
  },
);

export default router;
