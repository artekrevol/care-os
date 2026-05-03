import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  notificationTypesTable,
  notificationPreferencesTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import {
  ListNotificationTypesResponse,
  ListMyNotificationPreferencesResponse,
  UpdateMyNotificationPreferencesBody,
  UpdateMyNotificationPreferencesResponse,
  RegisterPushSubscriptionBody,
  GetVapidPublicKeyResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";

const router: IRouter = Router();

// Single-tenant demo binds the caregiver PWA to seeded caregiver cg_001's
// userId when no caller identity headers are present. Replace with
// auth-derived user identity once auth is wired up.
const DEFAULT_CAREGIVER_USER_ID = "user_caregiver_aisha";
const DEFAULT_CAREGIVER_ROLE = "CAREGIVER";

function getCallerIdentity(req: {
  header: (n: string) => string | undefined;
}): { userId: string; role: string } {
  const familyId = req.header("x-family-user-id");
  if (familyId) return { userId: familyId, role: "FAMILY" };
  const userId = req.header("x-user-id");
  if (userId) return { userId, role: req.header("x-user-role") ?? "OWNER" };
  return { userId: DEFAULT_CAREGIVER_USER_ID, role: DEFAULT_CAREGIVER_ROLE };
}

router.get("/notifications/types", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(notificationTypesTable)
    .where(eq(notificationTypesTable.isActive, true));
  res.json(
    ListNotificationTypesResponse.parse(
      rows.map((r) => ({
        id: r.id,
        category: r.category,
        label: r.label,
        description: r.description,
        defaultChannels: (r.defaultChannels ?? []) as Array<
          "EMAIL" | "SMS" | "PUSH" | "IN_APP"
        >,
        audienceRoles: r.audienceRoles ?? [],
        isActive: r.isActive,
      })),
    ),
  );
});

router.get(
  "/notifications/preferences",
  async (req, res): Promise<void> => {
    const { userId } = getCallerIdentity(req);
    const rows = await db
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.agencyId, AGENCY_ID),
          eq(notificationPreferencesTable.userId, userId),
        ),
      );
    res.json(
      ListMyNotificationPreferencesResponse.parse(
        rows.map((r) => ({
          notificationTypeId: r.notificationTypeId,
          channels: (r.channels ?? []) as Array<
            "EMAIL" | "SMS" | "PUSH" | "IN_APP"
          >,
          quietHoursStart: r.quietHoursStart,
          quietHoursEnd: r.quietHoursEnd,
          timezone: r.timezone,
          enabled: r.enabled,
        })),
      ),
    );
  },
);

router.put(
  "/notifications/preferences",
  async (req, res): Promise<void> => {
    const parsed = UpdateMyNotificationPreferencesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { userId, role } = getCallerIdentity(req);
    for (const item of parsed.data) {
      const [existing] = await db
        .select()
        .from(notificationPreferencesTable)
        .where(
          and(
            eq(notificationPreferencesTable.agencyId, AGENCY_ID),
            eq(notificationPreferencesTable.userId, userId),
            eq(
              notificationPreferencesTable.notificationTypeId,
              item.notificationTypeId,
            ),
          ),
        );
      if (existing) {
        await db
          .update(notificationPreferencesTable)
          .set({
            channels: item.channels,
            quietHoursStart: item.quietHoursStart ?? null,
            quietHoursEnd: item.quietHoursEnd ?? null,
            timezone: item.timezone ?? null,
            enabled: item.enabled,
          })
          .where(eq(notificationPreferencesTable.id, existing.id));
      } else {
        await db.insert(notificationPreferencesTable).values({
          id: newId("npref"),
          agencyId: AGENCY_ID,
          userId,
          userRole: role,
          notificationTypeId: item.notificationTypeId,
          channels: item.channels,
          quietHoursStart: item.quietHoursStart ?? null,
          quietHoursEnd: item.quietHoursEnd ?? null,
          timezone: item.timezone ?? null,
          enabled: item.enabled,
        });
      }
    }
    const rows = await db
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.agencyId, AGENCY_ID),
          eq(notificationPreferencesTable.userId, userId),
        ),
      );
    res.json(
      UpdateMyNotificationPreferencesResponse.parse(
        rows.map((r) => ({
          notificationTypeId: r.notificationTypeId,
          channels: (r.channels ?? []) as Array<
            "EMAIL" | "SMS" | "PUSH" | "IN_APP"
          >,
          quietHoursStart: r.quietHoursStart,
          quietHoursEnd: r.quietHoursEnd,
          timezone: r.timezone,
          enabled: r.enabled,
        })),
      ),
    );
  },
);

router.post(
  "/notifications/push/subscribe",
  async (req, res): Promise<void> => {
    const parsed = RegisterPushSubscriptionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { userId, role } = getCallerIdentity(req);
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
          userRole: role,
        })
        .where(eq(pushSubscriptionsTable.id, existing.id));
    } else {
      await db.insert(pushSubscriptionsTable).values({
        id: newId("psub"),
        agencyId: AGENCY_ID,
        userId,
        userRole: role,
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
