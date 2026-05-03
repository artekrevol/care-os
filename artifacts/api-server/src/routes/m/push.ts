import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { AGENCY_ID } from "../../lib/agency";
import { newId } from "../../lib/ids";
import {
  requireCaregiverSession,
  loadCaregiver,
  type MAuthedRequest,
} from "./middleware";

const router: IRouter = Router();

const MPushSubscribeBody = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().optional(),
});

router.get(
  "/m/push/vapid-public-key",
  requireCaregiverSession,
  (_req, res): void => {
    res.json({ publicKey: process.env["VAPID_PUBLIC_KEY"] ?? null });
  },
);

router.post(
  "/m/push/subscribe",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = MPushSubscribeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const cg = await loadCaregiver(caregiverId);
    const userId = cg?.userId ?? caregiverId;
    const { endpoint, p256dh, auth, userAgent } = parsed.data;
    const [existing] = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.agencyId, AGENCY_ID),
          eq(pushSubscriptionsTable.endpoint, endpoint),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(pushSubscriptionsTable)
        .set({
          p256dh,
          auth,
          userAgent: userAgent ?? null,
          userId,
          userRole: "CAREGIVER",
        })
        .where(eq(pushSubscriptionsTable.id, existing.id));
    } else {
      await db.insert(pushSubscriptionsTable).values({
        id: newId("psub"),
        agencyId: AGENCY_ID,
        userId,
        userRole: "CAREGIVER",
        endpoint,
        p256dh,
        auth,
        userAgent: userAgent ?? null,
      });
    }
    res.status(204).end();
  },
);

router.post(
  "/m/push/unsubscribe",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const endpoint = (req.body as { endpoint?: string } | null)?.endpoint;
    if (!endpoint) {
      res.status(400).json({ error: "endpoint required" });
      return;
    }
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.agencyId, AGENCY_ID),
          eq(pushSubscriptionsTable.endpoint, endpoint),
        ),
      );
    res.status(204).end();
  },
);

export default router;
