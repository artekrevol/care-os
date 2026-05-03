import { and, eq, gte, lte, lt, gt, ne } from "drizzle-orm";
import {
  db,
  schedulesTable,
  caregiversTable,
  caregiverDocumentsTable,
  authorizationsTable,
  clientsTable,
} from "@workspace/db";
import { maps } from "@workspace/services";
import { AGENCY_ID } from "./agency";
import { pickHomeLatLng } from "./geo";

export type ScheduleConflict = {
  type:
    | "DOUBLE_BOOK"
    | "EXPIRED_CREDENTIAL"
    | "AUTH_OVERRUN"
    | "AUTH_EXPIRED"
    | "OT_THRESHOLD"
    | "OUTSIDE_AUTH_HOURS"
    | "DRIVE_TIME_IMPOSSIBLE";
  message: string;
  severity: "WARNING" | "BLOCK";
};

const REQUIRED_DOC_TYPES = ["BACKGROUND_CHECK", "TB_TEST", "CPR"];

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function validateSchedule(input: {
  caregiverId: string;
  clientId: string;
  startTime: Date;
  endTime: Date;
  authorizationId?: string | null;
  excludeScheduleId?: string;
}): Promise<ScheduleConflict[]> {
  const conflicts: ScheduleConflict[] = [];
  const { caregiverId, clientId, startTime, endTime, excludeScheduleId } = input;

  // 1) DOUBLE_BOOK against caregiver's other shifts
  const overlapConds = [
    eq(schedulesTable.agencyId, AGENCY_ID),
    eq(schedulesTable.caregiverId, caregiverId),
    lt(schedulesTable.startTime, endTime),
    gt(schedulesTable.endTime, startTime),
  ];
  if (excludeScheduleId) {
    overlapConds.push(ne(schedulesTable.id, excludeScheduleId));
  }
  const overlaps = await db
    .select()
    .from(schedulesTable)
    .where(and(...overlapConds));
  for (const o of overlaps) {
    conflicts.push({
      type: "DOUBLE_BOOK",
      severity: "BLOCK",
      message: `Caregiver already booked ${o.startTime.toISOString().slice(11, 16)}–${o.endTime.toISOString().slice(11, 16)} on ${dateOnly(o.startTime)}.`,
    });
  }

  // 2) EXPIRED_CREDENTIAL — required docs missing or expired
  const docs = await db
    .select()
    .from(caregiverDocumentsTable)
    .where(
      and(
        eq(caregiverDocumentsTable.agencyId, AGENCY_ID),
        eq(caregiverDocumentsTable.caregiverId, caregiverId),
      ),
    );
  for (const required of REQUIRED_DOC_TYPES) {
    const docsOfType = docs.filter((d) => d.documentType === required);
    if (docsOfType.length === 0) {
      conflicts.push({
        type: "EXPIRED_CREDENTIAL",
        severity: "BLOCK",
        message: `Missing required document: ${required.replace(/_/g, " ").toLowerCase()}.`,
      });
      continue;
    }
    const newest = docsOfType.reduce((best, d) => {
      const candidate = d.expirationDate ? new Date(d.expirationDate) : null;
      const bestDate = best.expirationDate ? new Date(best.expirationDate) : null;
      if (!bestDate) return d;
      if (!candidate) return best;
      return candidate.getTime() > bestDate.getTime() ? d : best;
    });
    if (newest.expirationDate) {
      const exp = new Date(newest.expirationDate + "T23:59:59Z");
      if (exp.getTime() < startTime.getTime()) {
        conflicts.push({
          type: "EXPIRED_CREDENTIAL",
          severity: "BLOCK",
          message: `${required.replace(/_/g, " ")} expired on ${newest.expirationDate}.`,
        });
      }
    }
  }

  // 3) Authorization checks
  let auth: typeof authorizationsTable.$inferSelect | null = null;
  if (input.authorizationId) {
    const [row] = await db
      .select()
      .from(authorizationsTable)
      .where(
        and(
          eq(authorizationsTable.agencyId, AGENCY_ID),
          eq(authorizationsTable.id, input.authorizationId),
        ),
      );
    auth = row ?? null;
  } else {
    // Auto-pick a still-valid client authorization that covers the start date
    const candidates = await db
      .select()
      .from(authorizationsTable)
      .where(
        and(
          eq(authorizationsTable.agencyId, AGENCY_ID),
          eq(authorizationsTable.clientId, clientId),
        ),
      );
    auth =
      candidates.find(
        (a) => new Date(a.expirationDate + "T23:59:59Z") >= startTime,
      ) ??
      candidates[0] ??
      null;
  }

  if (auth) {
    const expDate = new Date(auth.expirationDate + "T23:59:59Z");
    if (expDate.getTime() < startTime.getTime()) {
      conflicts.push({
        type: "AUTH_EXPIRED",
        severity: "BLOCK",
        message: `Authorization ${auth.authNumber} expired on ${auth.expirationDate}.`,
      });
    } else {
      // OUTSIDE_AUTH_HOURS — total hours used + projected exceeds approvedHoursTotal
      const hoursUsed = Number(auth.hoursUsed);
      const approvedTotal = Number(auth.approvedHoursTotal);
      const proposedHours =
        (endTime.getTime() - startTime.getTime()) / 3600000;
      if (hoursUsed + proposedHours > approvedTotal) {
        conflicts.push({
          type: "OUTSIDE_AUTH_HOURS",
          severity: "BLOCK",
          message: `Adds ${proposedHours.toFixed(1)}h beyond authorization total (${hoursUsed.toFixed(1)}/${approvedTotal.toFixed(1)}h used).`,
        });
      }
      // AUTH_OVERRUN — weekly cap
      const weekStart = new Date(startTime);
      const day = weekStart.getUTCDay();
      const offset = (day + 6) % 7;
      weekStart.setUTCDate(weekStart.getUTCDate() - offset);
      weekStart.setUTCHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const weekShifts = await db
        .select()
        .from(schedulesTable)
        .where(
          and(
            eq(schedulesTable.agencyId, AGENCY_ID),
            eq(schedulesTable.clientId, clientId),
            eq(schedulesTable.authorizationId, auth.id),
            gte(schedulesTable.startTime, weekStart),
            lte(schedulesTable.startTime, weekEnd),
          ),
        );
      const weekMinutes = weekShifts
        .filter((s) => s.id !== excludeScheduleId)
        .reduce((s, x) => s + x.scheduledMinutes, 0);
      const projectedWeek = weekMinutes + (proposedHours * 60);
      const weeklyCap = Number(auth.approvedHoursPerWeek) * 60;
      if (projectedWeek > weeklyCap) {
        conflicts.push({
          type: "AUTH_OVERRUN",
          severity: "WARNING",
          message: `Projected ${(projectedWeek / 60).toFixed(1)}h this week exceeds weekly cap of ${(weeklyCap / 60).toFixed(1)}h on auth ${auth.authNumber}.`,
        });
      }
    }
  }
  // 4) DRIVE_TIME_IMPOSSIBLE — adjacent shifts on the same day with insufficient gap
  const dayStart = new Date(startTime);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const sameDayConds = [
    eq(schedulesTable.agencyId, AGENCY_ID),
    eq(schedulesTable.caregiverId, caregiverId),
    gte(schedulesTable.startTime, dayStart),
    lte(schedulesTable.startTime, dayEnd),
  ];
  if (excludeScheduleId) {
    sameDayConds.push(ne(schedulesTable.id, excludeScheduleId));
  }
  const sameDay = await db
    .select()
    .from(schedulesTable)
    .where(and(...sameDayConds));
  const before = sameDay
    .filter((s) => s.endTime.getTime() <= startTime.getTime())
    .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())[0];
  const after = sameDay
    .filter((s) => s.startTime.getTime() >= endTime.getTime())
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
  const [thisClient] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  const thisLatLng = pickHomeLatLng({
    homeLat: thisClient?.homeLat,
    homeLng: thisClient?.homeLng,
    city: thisClient?.city,
  });

  for (const adj of [before, after].filter(Boolean) as (typeof sameDay)[number][]) {
    if (adj.clientId === clientId) continue;
    const [adjClient] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, adj.clientId));
    const adjLatLng = pickHomeLatLng({
      homeLat: adjClient?.homeLat,
      homeLng: adjClient?.homeLng,
      city: adjClient?.city,
    });
    if (!thisLatLng || !adjLatLng) continue;
    const driveBucket = startTime.getUTCHours();
    const dt = await maps.getDriveTime(thisLatLng, adjLatLng, driveBucket);
    const requiredSec = dt.durationSeconds;
    const gapMs =
      adj === before
        ? startTime.getTime() - adj.endTime.getTime()
        : adj.startTime.getTime() - endTime.getTime();
    const gapSec = Math.max(0, gapMs / 1000);
    if (gapSec < requiredSec) {
      conflicts.push({
        type: "DRIVE_TIME_IMPOSSIBLE",
        severity: gapSec < requiredSec * 0.5 ? "BLOCK" : "WARNING",
        message: `Only ${Math.round(gapSec / 60)} min between shifts but ${Math.round(requiredSec / 60)} min drive required.`,
      });
    }
  }

  return conflicts;
}

export function isBlocked(conflicts: ScheduleConflict[]): boolean {
  return conflicts.some((c) => c.severity === "BLOCK");
}
