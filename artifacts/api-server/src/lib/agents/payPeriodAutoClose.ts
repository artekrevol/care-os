import { and, eq, lt, sql } from "drizzle-orm";
import {
  db,
  payPeriodsTable,
  visitsTable,
  caregiversTable,
  laborRuleSetsTable,
  timeEntriesTable,
} from "@workspace/db";
import { AGENCY_ID } from "../agency";
import { newId } from "../ids";
import { recordAudit, SYSTEM_ACTOR } from "../audit";
import { applyRule, type RawWorkDay } from "../laborRuleEngine";
import { recordAgentRun } from "../agentRun";

export async function autoClosePayPeriods(
  triggeredBy = "cron",
): Promise<{ runId: string; closed: number; periodIds: string[] }> {
  const { value, runId } = await recordAgentRun(
    {
      agentName: "pay_period_auto_close",
      promptVersion: "rule-1.0",
      model: "rules-only",
      triggeredBy,
      triggerReason: "daily cron",
      inputSummary: "Open pay periods past end date",
    },
    async () => {
      const today = new Date().toISOString().slice(0, 10);
      const periods = await db
        .select()
        .from(payPeriodsTable)
        .where(
          and(
            eq(payPeriodsTable.agencyId, AGENCY_ID),
            eq(payPeriodsTable.status, "OPEN"),
            lt(payPeriodsTable.endDate, today),
          ),
        );
      const closedIds: string[] = [];
      if (periods.length === 0) {
        return {
          value: { closed: 0, periodIds: closedIds },
          outputSummary: "no eligible pay periods",
        };
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
      const cgs = await db
        .select()
        .from(caregiversTable)
        .where(eq(caregiversTable.agencyId, AGENCY_ID));
      const rateMap = new Map(cgs.map((c) => [c.id, Number(c.payRate)]));

      for (const p of periods) {
        const periodStart = new Date(p.startDate + "T00:00:00Z");
        const periodEnd = new Date(p.endDate + "T23:59:59Z");
        let entriesCreated = 0;
        if (activeRule) {
          const verifiedVisits = await db
            .select()
            .from(visitsTable)
            .where(
              and(
                eq(visitsTable.agencyId, AGENCY_ID),
                eq(visitsTable.verificationStatus, "VERIFIED"),
              ),
            );
          const inWindow = verifiedVisits.filter((v) => {
            if (!v.clockOutTime) return false;
            return v.clockOutTime >= periodStart && v.clockOutTime <= periodEnd;
          });
          const rows: RawWorkDay[] = inWindow.map((v) => ({
            caregiverId: v.caregiverId,
            visitId: v.id,
            workDate: (v.clockInTime ?? v.clockOutTime!).toISOString().slice(0, 10),
            minutes: v.durationMinutes ?? 0,
            payRate: rateMap.get(v.caregiverId) ?? 0,
          }));
          const computed = applyRule(activeRule, rows);
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
            entriesCreated = computed.length;
          }
        }
        await db
          .update(payPeriodsTable)
          .set({ status: "CLOSED" })
          .where(eq(payPeriodsTable.id, p.id));
        await recordAudit(SYSTEM_ACTOR, {
          action: "AUTO_CLOSE_PAY_PERIOD",
          entityType: "PayPeriod",
          entityId: p.id,
          summary: `Pay period ${p.startDate} – ${p.endDate} auto-closed (${entriesCreated} entries)`,
        });
        closedIds.push(p.id);
      }

      return {
        value: { closed: closedIds.length, periodIds: closedIds },
        outputSummary: `${closedIds.length} pay period(s) auto-closed`,
      };
    },
  );
  return { runId, ...value };
}

void sql;
