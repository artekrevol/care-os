import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  notificationPreferencesTable,
  notificationLogTable,
  notificationTypesTable,
} from "@workspace/db";
import { AGENCY_ID } from "./agency";
import { newId } from "./ids";

type Recipient = { userId: string; userRole: string };

export async function dispatchNotificationToUsers(args: {
  notificationTypeId: string;
  recipients: Recipient[];
  payload: Record<string, unknown>;
}): Promise<void> {
  const { notificationTypeId, recipients, payload } = args;
  if (recipients.length === 0) return;

  const [typeRow] = await db
    .select()
    .from(notificationTypesTable)
    .where(eq(notificationTypesTable.id, notificationTypeId));
  const defaultChannels = (typeRow?.defaultChannels ?? [
    "EMAIL",
    "IN_APP",
  ]) as string[];

  const userIds = recipients.map((r) => r.userId);
  const prefs = await db
    .select()
    .from(notificationPreferencesTable)
    .where(
      and(
        eq(notificationPreferencesTable.agencyId, AGENCY_ID),
        eq(
          notificationPreferencesTable.notificationTypeId,
          notificationTypeId,
        ),
        inArray(notificationPreferencesTable.userId, userIds),
      ),
    );
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

  for (const r of recipients) {
    const pref = prefByUser.get(r.userId);
    if (pref && !pref.enabled) continue;
    const channels = pref?.channels?.length
      ? (pref.channels as string[])
      : defaultChannels;
    for (const channel of channels) {
      await db.insert(notificationLogTable).values({
        id: newId("nlog"),
        agencyId: AGENCY_ID,
        userId: r.userId,
        userRole: r.userRole,
        notificationTypeId,
        channel,
        status: "QUEUED",
        payload,
      });
    }
  }
}
