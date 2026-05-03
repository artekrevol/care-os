import { Router, type IRouter } from "express";
import { and, eq, gte, lte, sql, desc } from "drizzle-orm";
import {
  db,
  clientsTable,
  caregiversTable,
  schedulesTable,
  visitsTable,
  complianceAlertsTable,
  authorizationsTable,
  caregiverDocumentsTable,
  laborRuleSetsTable,
  auditLogTable,
} from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetRecentActivityResponse,
  GetOvertimeProjectionResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { applyRule, type RawWorkDay } from "../lib/laborRuleEngine";

const router: IRouter = Router();

function startOfWeekISO(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const offset = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfWeekISO(): string {
  const d = new Date(startOfWeekISO());
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const today = new Date();
  const dayStart = new Date(today);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const weekStart = startOfWeekISO();
  const weekEnd = endOfWeekISO();

  const [activeClients] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(clientsTable)
    .where(
      and(eq(clientsTable.agencyId, AGENCY_ID), eq(clientsTable.status, "ACTIVE")),
    );
  const [activeCaregivers] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(caregiversTable)
    .where(
      and(
        eq(caregiversTable.agencyId, AGENCY_ID),
        eq(caregiversTable.status, "ACTIVE"),
      ),
    );
  const [scheduledToday] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        gte(schedulesTable.startTime, dayStart),
        lte(schedulesTable.startTime, dayEnd),
      ),
    );
  const [completedToday] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, AGENCY_ID),
        gte(visitsTable.clockOutTime, dayStart),
        lte(visitsTable.clockOutTime, dayEnd),
      ),
    );
  const [pendingExceptions] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, AGENCY_ID),
        sql`${visitsTable.verificationStatus} in ('PENDING','EXCEPTION')`,
      ),
    );
  const [openAlerts] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(complianceAlertsTable)
    .where(
      and(
        eq(complianceAlertsTable.agencyId, AGENCY_ID),
        eq(complianceAlertsTable.status, "OPEN"),
      ),
    );

  const auths = await db
    .select()
    .from(authorizationsTable)
    .where(eq(authorizationsTable.agencyId, AGENCY_ID));
  const expiringAuthCount = auths.filter((a) => {
    const days = Math.ceil(
      (new Date(a.expirationDate + "T00:00:00Z").getTime() - Date.now()) /
        (86400000),
    );
    return days >= 0 && days <= 14;
  }).length;

  const docs = await db
    .select()
    .from(caregiverDocumentsTable)
    .where(eq(caregiverDocumentsTable.agencyId, AGENCY_ID));
  const expiringDocCount = docs.filter((d) => {
    if (!d.expirationDate) return false;
    const days = Math.ceil(
      (new Date(d.expirationDate + "T00:00:00Z").getTime() - Date.now()) /
        86400000,
    );
    return days >= 0 && days <= 30;
  }).length;

  const weekVisits = await db
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, AGENCY_ID),
        gte(visitsTable.clockInTime, new Date(weekStart)),
        lte(visitsTable.clockInTime, new Date(weekEnd)),
      ),
    );
  const weeklyMinutesDelivered = weekVisits.reduce(
    (s, v) => s + (v.durationMinutes ?? 0),
    0,
  );

  const weekSchedules = await db
    .select()
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        gte(schedulesTable.startTime, new Date(weekStart)),
        lte(schedulesTable.startTime, new Date(weekEnd)),
      ),
    );
  const weeklyMinutesScheduled = weekSchedules.reduce(
    (s, sc) => s + sc.scheduledMinutes,
    0,
  );

  const [activeRule] = await db
    .select()
    .from(laborRuleSetsTable)
    .where(
      and(
        eq(laborRuleSetsTable.agencyId, AGENCY_ID),
        eq(laborRuleSetsTable.isActive, true),
      ),
    );

  // Project OT for the rest of the week using scheduled hours
  let projectedOtMinutes = 0;
  let projectedOtCost = 0;
  if (activeRule) {
    const rows: RawWorkDay[] = [];
    const cgMap = new Map<string, number>();
    const cgs = await db
      .select()
      .from(caregiversTable)
      .where(eq(caregiversTable.agencyId, AGENCY_ID));
    for (const c of cgs) cgMap.set(c.id, Number(c.payRate));
    for (const sc of weekSchedules) {
      rows.push({
        caregiverId: sc.caregiverId,
        visitId: sc.id,
        workDate: sc.startTime.toISOString().slice(0, 10),
        minutes: sc.scheduledMinutes,
        payRate: cgMap.get(sc.caregiverId) ?? 0,
      });
    }
    const computed = applyRule(activeRule, rows);
    projectedOtMinutes = computed.reduce(
      (s, e) => s + e.overtimeMinutes + e.doubleTimeMinutes,
      0,
    );
    projectedOtCost = computed.reduce(
      (s, e) => s + e.overtimePay + e.doubleTimePay,
      0,
    );
  }

  res.json(
    GetDashboardSummaryResponse.parse({
      activeClients: activeClients?.c ?? 0,
      activeCaregivers: activeCaregivers?.c ?? 0,
      scheduledVisitsToday: scheduledToday?.c ?? 0,
      completedVisitsToday: completedToday?.c ?? 0,
      pendingExceptions: pendingExceptions?.c ?? 0,
      openAlerts: openAlerts?.c ?? 0,
      expiringAuthorizations: expiringAuthCount,
      expiringDocuments: expiringDocCount,
      weeklyHoursDelivered: Math.round((weeklyMinutesDelivered / 60) * 10) / 10,
      weeklyHoursScheduled: Math.round((weeklyMinutesScheduled / 60) * 10) / 10,
      projectedWeeklyOvertimeHours:
        Math.round((projectedOtMinutes / 60) * 10) / 10,
      projectedWeeklyOvertimeCost: Math.round(projectedOtCost * 100) / 100,
      activeRuleName: activeRule?.name ?? "No rule selected",
      activeRuleState: activeRule?.state ?? "—",
    }),
  );
});

router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.agencyId, AGENCY_ID))
    .orderBy(desc(auditLogTable.timestamp))
    .limit(20);
  const mapped = items.map((a) => {
    let kind: "VISIT_VERIFIED" | "VISIT_EXCEPTION" | "CLIENT_INTAKE" | "ALERT" | "SCHEDULE" = "SCHEDULE";
    if (a.action === "VERIFY_VISIT") kind = "VISIT_VERIFIED";
    else if (a.action === "VISIT_EXCEPTION") kind = "VISIT_EXCEPTION";
    else if (a.action === "CREATE_CLIENT") kind = "CLIENT_INTAKE";
    else if (a.action.includes("ALERT")) kind = "ALERT";
    return {
      id: a.id,
      kind,
      title: a.summary,
      subtitle: `${a.entityType}${a.entityId ? ` · ${a.entityId}` : ""}`,
      timestamp: a.timestamp,
    };
  });
  res.json(GetRecentActivityResponse.parse(mapped));
});

router.get("/dashboard/overtime-projection", async (_req, res): Promise<void> => {
  const weekStart = startOfWeekISO();
  const weekEnd = endOfWeekISO();
  const [activeRule] = await db
    .select()
    .from(laborRuleSetsTable)
    .where(
      and(
        eq(laborRuleSetsTable.agencyId, AGENCY_ID),
        eq(laborRuleSetsTable.isActive, true),
      ),
    );
  const cgs = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.agencyId, AGENCY_ID));
  const cgMap = new Map(cgs.map((c) => [c.id, c]));
  const weekSchedules = await db
    .select()
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        gte(schedulesTable.startTime, new Date(weekStart)),
        lte(schedulesTable.startTime, new Date(weekEnd)),
      ),
    );

  const rows: RawWorkDay[] = weekSchedules.map((sc) => ({
    caregiverId: sc.caregiverId,
    visitId: sc.id,
    workDate: sc.startTime.toISOString().slice(0, 10),
    minutes: sc.scheduledMinutes,
    payRate: Number(cgMap.get(sc.caregiverId)?.payRate ?? 0),
  }));

  const computed = activeRule ? applyRule(activeRule, rows) : [];
  const byCg = new Map<
    string,
    {
      caregiverId: string;
      caregiverName: string;
      scheduledMinutes: number;
      projectedRegularMinutes: number;
      projectedOvertimeMinutes: number;
      projectedDoubleTimeMinutes: number;
      projectedOvertimeCost: number;
    }
  >();
  for (const c of cgs) {
    byCg.set(c.id, {
      caregiverId: c.id,
      caregiverName: `${c.firstName} ${c.lastName}`,
      scheduledMinutes: 0,
      projectedRegularMinutes: 0,
      projectedOvertimeMinutes: 0,
      projectedDoubleTimeMinutes: 0,
      projectedOvertimeCost: 0,
    });
  }
  for (const sc of weekSchedules) {
    const e = byCg.get(sc.caregiverId);
    if (e) e.scheduledMinutes += sc.scheduledMinutes;
  }
  for (const e of computed) {
    const t = byCg.get(e.caregiverId);
    if (!t) continue;
    t.projectedRegularMinutes += e.regularMinutes;
    t.projectedOvertimeMinutes += e.overtimeMinutes;
    t.projectedDoubleTimeMinutes += e.doubleTimeMinutes;
    t.projectedOvertimeCost += e.overtimePay + e.doubleTimePay;
  }
  const entries = [...byCg.values()].filter((e) => e.scheduledMinutes > 0);
  const totalOvertimeHours =
    Math.round(
      (entries.reduce((s, e) => s + e.projectedOvertimeMinutes, 0) / 60) * 10,
    ) / 10;
  const totalDoubleTimeHours =
    Math.round(
      (entries.reduce((s, e) => s + e.projectedDoubleTimeMinutes, 0) / 60) *
        10,
    ) / 10;
  const totalOvertimeCost =
    Math.round(entries.reduce((s, e) => s + e.projectedOvertimeCost, 0) * 100) /
    100;

  res.json(
    GetOvertimeProjectionResponse.parse({
      ruleName: activeRule?.name ?? "No rule selected",
      ruleState: activeRule?.state ?? "—",
      totalOvertimeHours,
      totalDoubleTimeHours,
      totalOvertimeCost,
      entries: entries.map((e) => ({
        ...e,
        projectedOvertimeCost: Math.round(e.projectedOvertimeCost * 100) / 100,
      })),
    }),
  );
});

export default router;
