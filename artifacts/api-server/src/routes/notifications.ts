import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import {
  RegisterPushSubscriptionBody,
  GetVapidPublicKeyResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";

const router: IRouter = Router();

// Single-tenant demo binds the caregiver PWA to seeded caregiver cg_001's
// userId. The notifications service resolves caregiver recipients via
// `caregivers.userId` (not `caregivers.id`), so this id must match
// caregivers.userId on cg_001 for server-side push fanout to find this
// subscription. Replace with auth-derived user identity once auth is wired up.
const CURRENT_USER_ID = "user_caregiver_aisha";
const CURRENT_USER_ROLE = "CAREGIVER";

router.post(
  "/notifications/push/subscribe",
  async (req, res): Promise<void> => {
    const parsed = RegisterPushSubscriptionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { endpoint, p256dh, auth, userAgent } = parsed.data;

    const existing = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.agencyId, AGENCY_ID),
          eq(pushSubscriptionsTable.endpoint, endpoint),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(pushSubscriptionsTable)
        .set({
          p256dh,
          auth,
          userAgent: userAgent ?? null,
          userId: CURRENT_USER_ID,
          userRole: CURRENT_USER_ROLE,
        })
        .where(eq(pushSubscriptionsTable.id, existing[0].id));
    } else {
      await db.insert(pushSubscriptionsTable).values({
        id: newId("psub"),
        agencyId: AGENCY_ID,
        userId: CURRENT_USER_ID,
        userRole: CURRENT_USER_ROLE,
        endpoint,
        p256dh,
        auth,
        userAgent: userAgent ?? null,
      });
    }
    res.status(204).end();
  },
);

router.get(
  "/notifications/push/vapid-public-key",
  async (_req, res): Promise<void> => {
    const publicKey = process.env["VAPID_PUBLIC_KEY"] ?? null;
    res.json(GetVapidPublicKeyResponse.parse({ publicKey }));
  },
);

export default router;
