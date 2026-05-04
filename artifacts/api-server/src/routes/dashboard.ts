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
  const todayDate = dayStart.toISOString().slice(0, 10);

  const [
    countsResult,
    [weeklyDelivered],
    weekSchedules,
    [activeRule],
    caregivers,
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM ${clientsTable}
         WHERE agency_id = ${AGENCY_ID} AND status = 'ACTIVE') AS active_clients,
        (SELECT count(*)::int FROM ${caregiversTable}
         WHERE agency_id = ${AGENCY_ID} AND status = 'ACTIVE') AS active_caregivers,
        (SELECT count(*)::int FROM ${schedulesTable}
         WHERE agency_id = ${AGENCY_ID}
           AND start_time >= ${dayStart} AND start_time <= ${dayEnd}) AS scheduled_today,
        (SELECT count(*)::int FROM ${visitsTable}
         WHERE agency_id = ${AGENCY_ID}
           AND clock_out_time >= ${dayStart} AND clock_out_time <= ${dayEnd}) AS completed_today,
        (SELECT count(*)::int FROM ${visitsTable}
         WHERE agency_id = ${AGENCY_ID}
           AND verification_status IN ('PENDING','EXCEPTION')) AS pending_exceptions,
        (SELECT count(*)::int FROM ${complianceAlertsTable}
         WHERE agency_id = ${AGENCY_ID} AND status = 'OPEN') AS open_alerts,
        (SELECT count(*)::int FROM ${authorizationsTable}
         WHERE agency_id = ${AGENCY_ID}
           AND expiration_date >= ${todayDate}
           AND expiration_date <= (${todayDate}::date + interval '14 days')::date) AS expiring_auths,
        (SELECT count(*)::int FROM ${caregiverDocumentsTable}
         WHERE agency_id = ${AGENCY_ID}
           AND expiration_date IS NOT NULL
           AND expiration_date >= ${todayDate}
           AND expiration_date <= (${todayDate}::date + interval '30 days')::date) AS expiring_docs
    `),
    db
      .select({ m: sql<number>`coalesce(sum(duration_minutes), 0)::int` })
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.agencyId, AGENCY_ID),
          gte(visitsTable.clockInTime, new Date(weekStart)),
          lte(visitsTable.clockInTime, new Date(weekEnd)),
        ),
      ),
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.agencyId, AGENCY_ID),
          gte(schedulesTable.startTime, new Date(weekStart)),
          lte(schedulesTable.startTime, new Date(weekEnd)),
        ),
      ),
    db
      .select()
      .from(laborRuleSetsTable)
      .where(
        and(
          eq(laborRuleSetsTable.agencyId, AGENCY_ID),
          eq(laborRuleSetsTable.isActive, true),
        ),
      ),
    db
      .select({ id: caregiversTable.id, payRate: caregiversTable.payRate })
      .from(caregiversTable)
      .where(eq(caregiversTable.agencyId, AGENCY_ID)),
  ]);

  const counts = countsResult.rows[0] as {
    active_clients: number;
    active_caregivers: number;
    scheduled_today: number;
    completed_today: number;
    pending_exceptions: number;
    open_alerts: number;
    expiring_auths: number;
    expiring_docs: number;
  } | undefined;

  const weeklyMinutesScheduled = weekSchedules.reduce(
    (s, sc) => s + sc.scheduledMinutes,
    0,
  );

  let projectedOtMinutes = 0;
  let projectedOtCost = 0;
  if (activeRule) {
    const cgMap = new Map(caregivers.map((c) => [c.id, Number(c.payRate)]));
    const rows: RawWorkDay[] = weekSchedules.map((sc) => ({
      caregiverId: sc.caregiverId,
      visitId: sc.id,
      workDate: sc.startTime.toISOString().slice(0, 10),
      minutes: sc.scheduledMinutes,
      payRate: cgMap.get(sc.caregiverId) ?? 0,
    }));
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
      activeClients: counts?.active_clients ?? 0,
      activeCaregivers: counts?.active_caregivers ?? 0,
      scheduledVisitsToday: counts?.scheduled_today ?? 0,
      completedVisitsToday: counts?.completed_today ?? 0,
      pendingExceptions: counts?.pending_exceptions ?? 0,
      openAlerts: counts?.open_alerts ?? 0,
      expiringAuthorizations: counts?.expiring_auths ?? 0,
      expiringDocuments: counts?.expiring_docs ?? 0,
      weeklyHoursDelivered: Math.round(((weeklyDelivered?.m ?? 0) / 60) * 10) / 10,
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

router.get("/dashboard/ot-projection", async (_req, res): Promise<void> => {
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
