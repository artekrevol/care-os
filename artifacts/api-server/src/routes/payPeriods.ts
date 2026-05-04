import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, asc, desc, inArray } from "drizzle-orm";
import {
  db,
  payPeriodsTable,
  timeEntriesTable,
  visitsTable,
  caregiversTable,
  laborRuleSetsTable,
} from "@workspace/db";
import {
  ListPayPeriodsResponse,
  GetPayPeriodParams,
  GetPayPeriodResponse,
  ClosePayPeriodParams,
  ClosePayPeriodResponse,
  ExportPayPeriodCsvParams,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { dispatchNotificationToUsers } from "../lib/notify";
import { applyRule, type RawWorkDay } from "../lib/laborRuleEngine";

const router: IRouter = Router();

async function periodTotals(periodId: string) {
  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.agencyId, AGENCY_ID),
        eq(timeEntriesTable.payPeriodId, periodId),
      ),
    );
  let regMin = 0,
    otMin = 0,
    dtMin = 0,
    gross = 0;
  const cgs = new Set<string>();
  for (const e of entries) {
    regMin += e.regularMinutes;
    otMin += e.overtimeMinutes;
    dtMin += e.doubleTimeMinutes;
    gross += Number(e.regularPay) + Number(e.overtimePay) + Number(e.doubleTimePay);
    cgs.add(e.caregiverId);
  }
  return {
    totalRegularHours: Math.round((regMin / 60) * 10) / 10,
    totalOvertimeHours: Math.round((otMin / 60) * 10) / 10,
    totalDoubleTimeHours: Math.round((dtMin / 60) * 10) / 10,
    totalGrossPay: Math.round(gross * 100) / 100,
    caregiverCount: cgs.size,
    entries,
  };
}

router.get("/pay-periods", async (_req, res): Promise<void> => {
  const periods = await db
    .select()
    .from(payPeriodsTable)
    .where(eq(payPeriodsTable.agencyId, AGENCY_ID))
    .orderBy(desc(payPeriodsTable.startDate));
  const periodIds = periods.map((p) => p.id);
  const allEntries = periodIds.length
    ? await db
        .select()
        .from(timeEntriesTable)
        .where(
          and(
            eq(timeEntriesTable.agencyId, AGENCY_ID),
            inArray(timeEntriesTable.payPeriodId, periodIds),
          ),
        )
    : [];
  const entriesByPeriod = new Map<string, (typeof allEntries)[number][]>();
  for (const e of allEntries) {
    const arr = entriesByPeriod.get(e.payPeriodId) ?? [];
    arr.push(e);
    entriesByPeriod.set(e.payPeriodId, arr);
  }
  const out = periods.map((p) => {
    const entries = entriesByPeriod.get(p.id) ?? [];
    let regMin = 0,
      otMin = 0,
      dtMin = 0,
      gross = 0;
    const cgs = new Set<string>();
    for (const e of entries) {
      regMin += e.regularMinutes;
      otMin += e.overtimeMinutes;
      dtMin += e.doubleTimeMinutes;
      gross += Number(e.regularPay) + Number(e.overtimePay) + Number(e.doubleTimePay);
      cgs.add(e.caregiverId);
    }
    return {
      id: p.id,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      totalRegularHours: Math.round((regMin / 60) * 10) / 10,
      totalOvertimeHours: Math.round((otMin / 60) * 10) / 10,
      totalDoubleTimeHours: Math.round((dtMin / 60) * 10) / 10,
      totalGrossPay: Math.round(gross * 100) / 100,
      caregiverCount: cgs.size,
      exportedAt: p.exportedAt,
    };
  });
  res.json(ListPayPeriodsResponse.parse(out));
});

router.get("/pay-periods/:id", async (req, res): Promise<void> => {
  const params = GetPayPeriodParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [p] = await db
    .select()
    .from(payPeriodsTable)
    .where(
      and(eq(payPeriodsTable.agencyId, AGENCY_ID), eq(payPeriodsTable.id, params.data.id)),
    );
  if (!p) {
    res.status(404).json({ error: "Pay period not found" });
    return;
  }
  const t = await periodTotals(p.id);
  const cgs = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.agencyId, AGENCY_ID));
  const cgMap = new Map(cgs.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
  const formattedEntries = t.entries
    .sort((a, b) => a.workDate.localeCompare(b.workDate))
    .map((e) => ({
      id: e.id,
      caregiverId: e.caregiverId,
      caregiverName: cgMap.get(e.caregiverId) ?? "Unknown",
      visitId: e.visitId,
      workDate: e.workDate,
      regularMinutes: e.regularMinutes,
      overtimeMinutes: e.overtimeMinutes,
      doubleTimeMinutes: e.doubleTimeMinutes,
      payRate: Number(e.payRate),
      regularPay: Number(e.regularPay),
      overtimePay: Number(e.overtimePay),
      doubleTimePay: Number(e.doubleTimePay),
      totalPay:
        Math.round(
          (Number(e.regularPay) +
            Number(e.overtimePay) +
            Number(e.doubleTimePay)) *
            100,
        ) / 100,
      ruleEngineVersion: e.ruleEngineVersion,
    }));
  // Aggregate per-caregiver totals for the byCaregiver summary panel.
  const byCgMap = new Map<
    string,
    {
      caregiverId: string;
      caregiverName: string;
      regularMinutes: number;
      overtimeMinutes: number;
      doubleTimeMinutes: number;
      regularPay: number;
      overtimePay: number;
      doubleTimePay: number;
      totalPay: number;
    }
  >();
  for (const e of formattedEntries) {
    const cur = byCgMap.get(e.caregiverId) ?? {
      caregiverId: e.caregiverId,
      caregiverName: e.caregiverName,
      regularMinutes: 0,
      overtimeMinutes: 0,
      doubleTimeMinutes: 0,
      regularPay: 0,
      overtimePay: 0,
      doubleTimePay: 0,
      totalPay: 0,
    };
    cur.regularMinutes += e.regularMinutes;
    cur.overtimeMinutes += e.overtimeMinutes;
    cur.doubleTimeMinutes += e.doubleTimeMinutes;
    cur.regularPay += e.regularPay;
    cur.overtimePay += e.overtimePay;
    cur.doubleTimePay += e.doubleTimePay;
    cur.totalPay += e.totalPay;
    byCgMap.set(e.caregiverId, cur);
  }
  const byCaregiver = Array.from(byCgMap.values())
    .map((s) => ({
      ...s,
      regularPay: Math.round(s.regularPay * 100) / 100,
      overtimePay: Math.round(s.overtimePay * 100) / 100,
      doubleTimePay: Math.round(s.doubleTimePay * 100) / 100,
      totalPay: Math.round(s.totalPay * 100) / 100,
    }))
    .sort((a, b) => b.totalPay - a.totalPay);
  res.json(
    GetPayPeriodResponse.parse({
      id: p.id,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      totalRegularHours: t.totalRegularHours,
      totalOvertimeHours: t.totalOvertimeHours,
      totalDoubleTimeHours: t.totalDoubleTimeHours,
      totalGrossPay: t.totalGrossPay,
      caregiverCount: t.caregiverCount,
      exportedAt: p.exportedAt,
      entries: formattedEntries,
      byCaregiver,
    }),
  );
});

router.post(
  "/pay-periods/:id/close",
  async (req: Request, res: Response): Promise<void> => {
    const params = ClosePayPeriodParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [p] = await db
      .select()
      .from(payPeriodsTable)
      .where(
        and(
          eq(payPeriodsTable.agencyId, AGENCY_ID),
          eq(payPeriodsTable.id, params.data.id),
        ),
      );
    if (!p) {
      res.status(404).json({ error: "Pay period not found" });
      return;
    }
    if (p.status !== "OPEN") {
      res.status(400).json({ error: `Pay period is already ${p.status}` });
      return;
    }

    const [activeRule] = await db
      .select()
      .from(laborRuleSetsTable)
      .where(
        and(
          eq(laborRuleSetsTable.agencyId, AGENCY_ID),
          eq(laborRuleSetsTable.isActive, true),
        ),
      );
    if (!activeRule) {
      res.status(400).json({ error: "No active labor rule set" });
      return;
    }

    // Pull verified visits in this period
    const verifiedVisits = await db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.agencyId, AGENCY_ID),
          eq(visitsTable.verificationStatus, "VERIFIED"),
        ),
      );
    const periodStart = new Date(p.startDate + "T00:00:00Z");
    const periodEnd = new Date(p.endDate + "T23:59:59Z");
    const inWindow = verifiedVisits.filter((v) => {
      if (!v.clockOutTime) return false;
      return v.clockOutTime >= periodStart && v.clockOutTime <= periodEnd;
    });

    const cgs = await db
      .select()
      .from(caregiversTable)
      .where(eq(caregiversTable.agencyId, AGENCY_ID));
    const rateMap = new Map(cgs.map((c) => [c.id, Number(c.payRate)]));

    const rows: RawWorkDay[] = inWindow.map((v) => ({
      caregiverId: v.caregiverId,
      visitId: v.id,
      workDate: (v.clockInTime ?? v.clockOutTime!).toISOString().slice(0, 10),
      minutes: v.durationMinutes ?? 0,
      payRate: rateMap.get(v.caregiverId) ?? 0,
    }));
    const computed = applyRule(activeRule, rows);

    // Replace existing entries for this period
    await db
      .delete(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.agencyId, AGENCY_ID),
          eq(timeEntriesTable.payPeriodId, p.id),
        ),
      );
    if (computed.length) {
      await db.insert(timeEntriesTable).values(
        computed.map((e) => ({
          id: newId("te"),
          agencyId: AGENCY_ID,
          caregiverId: e.caregiverId,
          visitId: e.visitId,
          payPeriodId: p.id,
          workDate: e.workDate,
          regularMinutes: e.regularMinutes,
          overtimeMinutes: e.overtimeMinutes,
          doubleTimeMinutes: e.doubleTimeMinutes,
          payRate: String(e.payRate),
          regularPay: String(e.regularPay),
          overtimePay: String(e.overtimePay),
          doubleTimePay: String(e.doubleTimePay),
          ruleEngineVersion: e.ruleEngineVersion,
        })),
      );
    }

    const [updated] = await db
      .update(payPeriodsTable)
      .set({ status: "CLOSED" })
      .where(eq(payPeriodsTable.id, p.id))
      .returning();

    const t = await periodTotals(p.id);
    await recordAudit(req.user, {
      action: "CLOSE_PAY_PERIOD",
      entityType: "PayPeriod",
      entityId: p.id,
      summary: `Pay period ${p.startDate} – ${p.endDate} closed under ${activeRule.state}-${activeRule.version} (${computed.length} entries)`,
      afterState: updated,
    });
    // Notify caregivers whose entries were finalized in this period.
    try {
      const caregiverIds = Array.from(new Set(computed.map((e) => e.caregiverId)));
      if (caregiverIds.length > 0) {
        const cgs = await db
          .select({ id: caregiversTable.id, userId: caregiversTable.userId })
          .from(caregiversTable)
          .where(inArray(caregiversTable.id, caregiverIds));
        const recipients = cgs
          .filter((c) => c.userId)
          .map((c) => ({ userId: c.userId as string, userRole: "CAREGIVER" }));
        if (recipients.length > 0) {
          await dispatchNotificationToUsers({
            notificationTypeId: "payroll.period_closed",
            recipients,
            payload: {
              subject: "Pay period closed",
              body: `Your pay for ${p.startDate} – ${p.endDate} has been finalized.`,
              url: "/m/profile",
              payPeriodId: p.id,
            },
          });
        }
      }
    } catch {
      /* ignore */
    }

    res.json(
      ClosePayPeriodResponse.parse({
        id: updated.id,
        startDate: updated.startDate,
        endDate: updated.endDate,
        status: updated.status,
        totalRegularHours: t.totalRegularHours,
        totalOvertimeHours: t.totalOvertimeHours,
        totalDoubleTimeHours: t.totalDoubleTimeHours,
        totalGrossPay: t.totalGrossPay,
        caregiverCount: t.caregiverCount,
        exportedAt: updated.exportedAt,
      }),
    );
  },
);

router.get("/pay-periods/:id/export", async (req, res): Promise<void> => {
  const params = ExportPayPeriodCsvParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [p] = await db
    .select()
    .from(payPeriodsTable)
    .where(
      and(eq(payPeriodsTable.agencyId, AGENCY_ID), eq(payPeriodsTable.id, params.data.id)),
    );
  if (!p) {
    res.status(404).json({ error: "Pay period not found" });
    return;
  }
  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.agencyId, AGENCY_ID),
        eq(timeEntriesTable.payPeriodId, p.id),
      ),
    )
    .orderBy(asc(timeEntriesTable.workDate));
  const cgs = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.agencyId, AGENCY_ID));
  const cgMap = new Map(cgs.map((c) => [c.id, c]));
  const headers = [
    "caregiver_id",
    "caregiver_name",
    "work_date",
    "visit_id",
    "regular_minutes",
    "overtime_minutes",
    "double_time_minutes",
    "pay_rate",
    "regular_pay",
    "overtime_pay",
    "double_time_pay",
    "total_pay",
    "rule_engine_version",
  ];
  const lines = [headers.join(",")];
  for (const e of entries) {
    const cg = cgMap.get(e.caregiverId);
    const total =
      Number(e.regularPay) + Number(e.overtimePay) + Number(e.doubleTimePay);
    lines.push(
      [
        e.caregiverId,
        `"${cg ? `${cg.firstName} ${cg.lastName}` : ""}"`,
        e.workDate,
        e.visitId,
        e.regularMinutes,
        e.overtimeMinutes,
        e.doubleTimeMinutes,
        Number(e.payRate).toFixed(2),
        Number(e.regularPay).toFixed(2),
        Number(e.overtimePay).toFixed(2),
        Number(e.doubleTimePay).toFixed(2),
        total.toFixed(2),
        e.ruleEngineVersion,
      ].join(","),
    );
  }
  if (p.status === "CLOSED") {
    await db
      .update(payPeriodsTable)
      .set({ status: "EXPORTED", exportedAt: new Date() })
      .where(eq(payPeriodsTable.id, p.id));
    await recordAudit(req.user, {
      action: "EXPORT_PAY_PERIOD",
      entityType: "PayPeriod",
      entityId: p.id,
      summary: `Exported payroll CSV (${entries.length} entries)`,
    });
  }
  res
    .setHeader("Content-Type", "text/csv")
    .setHeader(
      "Content-Disposition",
      `attachment; filename="payroll-${p.startDate}-to-${p.endDate}.csv"`,
    )
    .send(lines.join("\n"));
});

export default router;
