import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db, schedulesTable, caregiversTable } from "@workspace/db";
import { AGENCY_ID } from "../agency";
import { dispatchNotificationToUsers } from "../notify";
import { logger } from "../logger";

/**
 * Find scheduled shifts starting in ~15 minutes and push a reminder to the
 * assigned caregiver. Idempotent within the dispatch window: the cron runs
 * every 5 minutes and we filter to a 15–20 minute lead window so each shift
 * only receives a single reminder under normal conditions.
 */
export async function runVisitReminders(): Promise<{
  reminded: number;
}> {
  const now = Date.now();
  const start = new Date(now + 15 * 60_000);
  const end = new Date(now + 20 * 60_000);
  const rows = await db
    .select({
      id: schedulesTable.id,
      caregiverId: schedulesTable.caregiverId,
      startTime: schedulesTable.startTime,
    })
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        eq(schedulesTable.status, "SCHEDULED"),
        gte(schedulesTable.startTime, start),
        lte(schedulesTable.startTime, end),
      ),
    );
  if (rows.length === 0) return { reminded: 0 };
  const cgIds = Array.from(new Set(rows.map((r) => r.caregiverId)));
  if (cgIds.length === 0) return { reminded: 0 };
  const cgs = await db
    .select({ id: caregiversTable.id, userId: caregiversTable.userId })
    .from(caregiversTable)
    .where(inArray(caregiversTable.id, cgIds));
  const userByCg = new Map(cgs.map((c) => [c.id, c.userId]));
  let reminded = 0;
  for (const r of rows) {
    const userId = userByCg.get(r.caregiverId);
    if (!userId) continue;
    try {
      await dispatchNotificationToUsers({
        notificationTypeId: "visit.reminder_15min",
        recipients: [{ userId, userRole: "CAREGIVER" }],
        payload: {
          subject: "Visit starting soon",
          body: `Your shift starts at ${r.startTime.toISOString().slice(11, 16)} UTC.`,
          url: "/m/",
          scheduleId: r.id,
        },
      });
      reminded += 1;
    } catch (err) {
      logger.warn({ err, scheduleId: r.id }, "visit reminder dispatch failed");
    }
  }
  return { reminded };
}
