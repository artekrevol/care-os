import { and, eq, gte, sql, desc } from "drizzle-orm";
import {
  db,
  visitsTable,
  schedulesTable,
  caregiversTable,
  clientsTable,
  anomalyEventsTable,
} from "@workspace/db";
import { AGENCY_ID } from "../agency";
import { newId } from "../ids";
import { recordAgentRun } from "../agentRun";
import { upsertAlert } from "./createAlert";

const HOURS_24 = 24 * 60 * 60 * 1000;
const DAYS_14 = 14 * 86400000;
const KM_PER_DEG = 111;

type AnomalyRecord = {
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  entityType: string;
  entityId: string;
  summary: string;
  evidence: Record<string, unknown>;
  alertType: string;
  alertTitle: string;
  alertMessage: string;
  suggestedAction: string;
  dedupeKey: string;
};

function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat1 - lat2) * KM_PER_DEG;
  const dLng =
    (lng1 - lng2) * KM_PER_DEG * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function fullName(rows: { id: string; firstName: string; lastName: string }[]) {
  return new Map(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));
}

export async function detectAnomalies(
  now: Date = new Date(),
): Promise<AnomalyRecord[]> {
  const since24 = new Date(now.getTime() - HOURS_24);
  const since14d = new Date(now.getTime() - DAYS_14);
  const since7d = new Date(now.getTime() - 7 * 86400000);

  const [allVisits, schedules, caregivers, clients] = await Promise.all([
    db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.agencyId, AGENCY_ID),
          gte(visitsTable.clockInTime, since14d),
        ),
      )
      .orderBy(desc(visitsTable.clockInTime)),
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.agencyId, AGENCY_ID),
          gte(schedulesTable.startTime, since14d),
        ),
      ),
    db
      .select()
      .from(caregiversTable)
      .where(eq(caregiversTable.agencyId, AGENCY_ID)),
    db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.agencyId, AGENCY_ID)),
  ]);

  const cgName = fullName(caregivers);
  const clName = fullName(clients);
  const out: AnomalyRecord[] = [];

  // 1. Long hours (>18h in 24h)
  const byCgRecent = new Map<string, typeof allVisits>();
  for (const v of allVisits) {
    if (!v.clockInTime || v.clockInTime < since24) continue;
    const list = byCgRecent.get(v.caregiverId) ?? [];
    list.push(v);
    byCgRecent.set(v.caregiverId, list);
  }
  for (const [cgId, vs] of byCgRecent) {
    const totalMin = vs.reduce((s, v) => s + (v.durationMinutes ?? 0), 0);
    if (totalMin > 18 * 60) {
      const hours = Math.round((totalMin / 60) * 10) / 10;
      const visitIds = vs.map((v) => v.id);
      out.push({
        category: "LONG_HOURS",
        severity: "CRITICAL",
        entityType: "Caregiver",
        entityId: cgId,
        summary: `${cgName.get(cgId) ?? cgId} clocked ${hours}h in 24h across ${vs.length} visits`,
        evidence: { hours, visitIds, windowStart: since24.toISOString() },
        alertType: "ANOMALY_LONG_HOURS",
        alertTitle: `${cgName.get(cgId) ?? cgId} clocked ${hours} hours in 24h`,
        alertMessage: `Caregiver ${cgName.get(cgId) ?? cgId} has logged ${hours} hours across ${vs.length} visit${vs.length === 1 ? "" : "s"} in the past 24 hours, which exceeds the 18-hour safety threshold and likely violates rest-period requirements.`,
        suggestedAction: `Reach out to ${cgName.get(cgId) ?? "the caregiver"} to confirm rest, audit the time entries for accuracy, and reassign upcoming shifts if fatigue risk is real.`,
        dedupeKey: `anomaly:long_hours:${cgId}:${now.toISOString().slice(0, 10)}`,
      });
    }
  }

  // 2. Impossible travel — back-to-back clock-ins separated by physically infeasible distance/time
  const byCgAll = new Map<string, typeof allVisits>();
  for (const v of allVisits) {
    const list = byCgAll.get(v.caregiverId) ?? [];
    list.push(v);
    byCgAll.set(v.caregiverId, list);
  }
  for (const [cgId, vsRaw] of byCgAll) {
    const vs = [...vsRaw]
      .filter((v) => v.clockInTime)
      .sort((a, b) => a.clockInTime!.getTime() - b.clockInTime!.getTime());
    for (let i = 1; i < vs.length; i++) {
      const prev = vs[i - 1];
      const cur = vs[i];
      const prevOut = prev.clockOutTime ?? prev.clockInTime!;
      const lat1 = prev.clockOutLat ?? prev.clockInLat;
      const lng1 = prev.clockOutLng ?? prev.clockInLng;
      const lat2 = cur.clockInLat;
      const lng2 = cur.clockInLng;
      if (!lat1 || !lng1 || !lat2 || !lng2) continue;
      const km = distanceKm(Number(lat1), Number(lng1), Number(lat2), Number(lng2));
      const minutesBetween =
        (cur.clockInTime!.getTime() - prevOut.getTime()) / 60000;
      if (minutesBetween <= 0) continue;
      // Assume max feasible average speed = 90 km/h door-to-door (highway w/ buffer)
      const maxKm = (minutesBetween / 60) * 90;
      if (km > maxKm + 5 && km > 20) {
        out.push({
          category: "IMPOSSIBLE_TRAVEL",
          severity: "HIGH",
          entityType: "Caregiver",
          entityId: cgId,
          summary: `${cgName.get(cgId) ?? cgId} traveled ${km.toFixed(1)}km in ${Math.round(minutesBetween)}min between visits`,
          evidence: {
            distanceKm: Math.round(km * 10) / 10,
            minutesBetween: Math.round(minutesBetween),
            prevVisitId: prev.id,
            nextVisitId: cur.id,
          },
          alertType: "ANOMALY_IMPOSSIBLE_TRAVEL",
          alertTitle: `Impossible travel for ${cgName.get(cgId) ?? cgId}`,
          alertMessage: `GPS shows ${cgName.get(cgId) ?? cgId} clocked out at one location and clocked in ${km.toFixed(1)}km away just ${Math.round(minutesBetween)} minutes later — physically impossible.`,
          suggestedAction:
            "Review the two visits' GPS records. Likely a clock-in done from the wrong device or by the wrong person — disable shared-account access if found.",
          dedupeKey: `anomaly:travel:${prev.id}:${cur.id}`,
        });
      }
    }
  }

  // 3. Visit duration deviation (>50%) versus its scheduled minutes
  const schById = new Map(schedules.map((s) => [s.id, s]));
  for (const v of allVisits) {
    if (!v.scheduleId || !v.durationMinutes) continue;
    const sch = schById.get(v.scheduleId);
    if (!sch || !sch.scheduledMinutes) continue;
    const dev = (v.durationMinutes - sch.scheduledMinutes) / sch.scheduledMinutes;
    if (Math.abs(dev) > 0.5 && Math.abs(v.durationMinutes - sch.scheduledMinutes) > 30) {
      const direction = dev > 0 ? "longer" : "shorter";
      out.push({
        category: "DURATION_DEVIATION",
        severity: "MEDIUM",
        entityType: "Visit",
        entityId: v.id,
        summary: `Visit ${v.id} ran ${(dev * 100).toFixed(0)}% ${direction} than scheduled`,
        evidence: {
          actualMinutes: v.durationMinutes,
          scheduledMinutes: sch.scheduledMinutes,
          deviationPct: Math.round(dev * 1000) / 10,
        },
        alertType: "ANOMALY_DURATION_DEVIATION",
        alertTitle: `Visit duration off by ${Math.abs(Math.round(dev * 100))}%`,
        alertMessage: `${cgName.get(v.caregiverId) ?? v.caregiverId} delivered ${v.durationMinutes} min for ${clName.get(v.clientId) ?? v.clientId} but the schedule called for ${sch.scheduledMinutes} min — ${direction} than expected.`,
        suggestedAction:
          dev > 0
            ? "Confirm overtime authorization and update the schedule template if this duration is the new normal."
            : "Verify all care plan tasks were completed; consider re-scheduling additional time or adjusting the plan.",
        dedupeKey: `anomaly:duration:${v.id}`,
      });
    }
  }

  // 4. Care-plan completion rate drop (recent week vs prior week)
  function avgTasks(rows: typeof allVisits): number {
    if (rows.length === 0) return 0;
    return (
      rows.reduce((s, v) => s + (v.tasksCompleted?.length ?? 0), 0) / rows.length
    );
  }
  const recentWeek = allVisits.filter(
    (v) => v.clockInTime && v.clockInTime >= since7d,
  );
  const priorWeek = allVisits.filter(
    (v) =>
      v.clockInTime &&
      v.clockInTime < since7d &&
      v.clockInTime >= new Date(now.getTime() - DAYS_14),
  );
  if (recentWeek.length >= 5 && priorWeek.length >= 5) {
    const recAvg = avgTasks(recentWeek);
    const prevAvg = avgTasks(priorWeek);
    if (prevAvg > 0 && recAvg / prevAvg < 0.7) {
      const drop = Math.round((1 - recAvg / prevAvg) * 100);
      out.push({
        category: "PLAN_COMPLETION",
        severity: "MEDIUM",
        entityType: "Agency",
        entityId: AGENCY_ID,
        summary: `Care-plan completion dropped ${drop}% this week`,
        evidence: { recAvg, prevAvg, dropPct: drop },
        alertType: "ANOMALY_PLAN_COMPLETION",
        alertTitle: `Care-plan completion fell ${drop}% this week`,
        alertMessage: `Average completed tasks per visit dropped from ${prevAvg.toFixed(1)} to ${recAvg.toFixed(1)} between last week and this week.`,
        suggestedAction:
          "Review supervisor reports and ride-alongs for the bottom 3 visits this week; refresh care-plan task templates if they no longer match reality.",
        dedupeKey: `anomaly:plan_drop:${now.toISOString().slice(0, 10)}`,
      });
    }
  }

  // 5. Repeated geofence misses for caregiver-client pair (>=3 in 14d)
  const geoMisses = new Map<string, { count: number; visitIds: string[] }>();
  for (const v of allVisits) {
    if (v.geoFenceMatch) continue;
    const k = `${v.caregiverId}::${v.clientId}`;
    const cur = geoMisses.get(k) ?? { count: 0, visitIds: [] };
    cur.count++;
    cur.visitIds.push(v.id);
    geoMisses.set(k, cur);
  }
  for (const [k, info] of geoMisses) {
    if (info.count < 3) continue;
    const [cgId, clId] = k.split("::");
    out.push({
      category: "REPEATED_GEO_MISS",
      severity: "HIGH",
      entityType: "Caregiver",
      entityId: cgId,
      summary: `${info.count} geofence misses between ${cgName.get(cgId) ?? cgId} and ${clName.get(clId) ?? clId}`,
      evidence: { count: info.count, visitIds: info.visitIds, clientId: clId },
      alertType: "ANOMALY_REPEATED_GEO_MISS",
      alertTitle: `Repeated geofence misses on ${clName.get(clId) ?? clId}'s visits`,
      alertMessage: `${cgName.get(cgId) ?? cgId} has clocked outside the geofence ${info.count} times in the past 14 days while caring for ${clName.get(clId) ?? clId}.`,
      suggestedAction:
        "Verify the client's address/geofence radius is correct and confirm the caregiver isn't routinely clocking from home — coach if needed.",
      dedupeKey: `anomaly:geo:${cgId}:${clId}`,
    });
  }

  // 6. Missed-shift trend (>=3 schedules without a matching visit in 14d, end time in past)
  const visitedScheduleIds = new Set(
    allVisits.map((v) => v.scheduleId).filter(Boolean) as string[],
  );
  const missedByCg = new Map<string, string[]>();
  for (const s of schedules) {
    if (s.endTime > now) continue;
    if (visitedScheduleIds.has(s.id)) continue;
    if (s.status === "CANCELLED") continue;
    const list = missedByCg.get(s.caregiverId) ?? [];
    list.push(s.id);
    missedByCg.set(s.caregiverId, list);
  }
  for (const [cgId, schIds] of missedByCg) {
    if (schIds.length < 3) continue;
    out.push({
      category: "MISSED_SHIFT_TREND",
      severity: "HIGH",
      entityType: "Caregiver",
      entityId: cgId,
      summary: `${cgName.get(cgId) ?? cgId} has ${schIds.length} unverified shifts in 14d`,
      evidence: { count: schIds.length, scheduleIds: schIds },
      alertType: "ANOMALY_MISSED_SHIFT_TREND",
      alertTitle: `${cgName.get(cgId) ?? cgId} trending toward missed shifts`,
      alertMessage: `${schIds.length} scheduled shifts for ${cgName.get(cgId) ?? cgId} ended in the past 14 days with no clock-in/out recorded.`,
      suggestedAction:
        "Pull recent attendance with the caregiver; if pattern continues, escalate to a coaching conversation and reassign higher-acuity clients.",
      dedupeKey: `anomaly:missed_shifts:${cgId}:${now.toISOString().slice(0, 10)}`,
    });
  }

  return out;
}

export async function runAnomalyDetector(triggeredBy = "cron"): Promise<{
  runId: string;
  anomalies: number;
  alertsCreated: number;
}> {
  const { value, runId } = await recordAgentRun(
    {
      agentName: "anomaly_detector",
      promptVersion: "rule-1.0",
      model: "rules-only",
      triggeredBy,
      triggerReason: "hourly cron",
      inputSummary: "Recent visits + schedules in past 14d",
    },
    async (id) => {
      const anomalies = await detectAnomalies();
      // persist anomaly_events (one per detection)
      if (anomalies.length) {
        await db.insert(anomalyEventsTable).values(
          anomalies.map((a) => ({
            id: newId("anom"),
            agencyId: AGENCY_ID,
            entityType: a.entityType,
            entityId: a.entityId,
            category: a.category,
            severity: a.severity,
            summary: a.summary,
            evidence: a.evidence,
            agentRunId: id,
          })),
        );
      }
      let alertsCreated = 0;
      for (const a of anomalies) {
        const created = await upsertAlert({
          alertType: a.alertType,
          severity: a.severity,
          entityType: a.entityType,
          entityId: a.entityId,
          title: a.alertTitle,
          message: a.alertMessage,
          suggestedAction: a.suggestedAction,
          dedupeKey: a.dedupeKey,
          agentRunId: id,
        });
        if (created) alertsCreated++;
      }
      return {
        value: { anomalies: anomalies.length, alertsCreated },
        outputSummary: `${anomalies.length} anomaly events, ${alertsCreated} new alerts`,
      };
    },
  );
  return { runId, ...value };
}
