import { and, eq, gte, lte } from "drizzle-orm";
import {
  db,
  caregiversTable,
  laborRuleSetsTable,
  schedulesTable,
  type LaborRuleSet,
} from "@workspace/db";
import { AGENCY_ID } from "./agency";
import { applyRuleToCaregiverWeek, type RawWorkDay } from "./laborRuleEngine";

export type OtImpact = {
  currentRegularMinutes: number;
  currentOvertimeMinutes: number;
  currentDoubleTimeMinutes: number;
  projectedRegularMinutes: number;
  projectedOvertimeMinutes: number;
  projectedDoubleTimeMinutes: number;
  deltaOvertimeMinutes: number;
  deltaDoubleTimeMinutes: number;
  deltaCostUsd: number;
  weeklyThresholdMinutes: number | null;
  dailyThresholdMinutes: number | null;
};

export function startOfIsoWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getUTCDay();
  const offset = (day + 6) % 7; // Monday-start
  out.setUTCDate(out.getUTCDate() - offset);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function endOfIsoWeek(d: Date): Date {
  const start = startOfIsoWeek(d);
  start.setUTCDate(start.getUTCDate() + 7);
  return start;
}

export async function getActiveLaborRule(): Promise<LaborRuleSet | null> {
  const [row] = await db
    .select()
    .from(laborRuleSetsTable)
    .where(
      and(
        eq(laborRuleSetsTable.agencyId, AGENCY_ID),
        eq(laborRuleSetsTable.isActive, true),
      ),
    );
  return row ?? null;
}

function toRawDays(
  caregiverId: string,
  payRate: number,
  rows: { id: string; startTime: Date; scheduledMinutes: number }[],
): RawWorkDay[] {
  return rows.map((r) => ({
    caregiverId,
    visitId: r.id,
    workDate: r.startTime.toISOString().slice(0, 10),
    minutes: r.scheduledMinutes,
    payRate,
  }));
}

export async function projectOtImpact(input: {
  caregiverId: string;
  startTime: Date;
  endTime: Date;
  excludeScheduleId?: string;
}): Promise<OtImpact> {
  const weekStart = startOfIsoWeek(input.startTime);
  const weekEnd = endOfIsoWeek(input.startTime);
  const [rule, [cg], existing] = await Promise.all([
    getActiveLaborRule(),
    db
      .select()
      .from(caregiversTable)
      .where(eq(caregiversTable.id, input.caregiverId)),
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.agencyId, AGENCY_ID),
          eq(schedulesTable.caregiverId, input.caregiverId),
          gte(schedulesTable.startTime, weekStart),
          lte(schedulesTable.startTime, weekEnd),
        ),
      ),
  ]);
  const payRate = cg ? Number(cg.payRate) : 0;

  const proposedMinutes = Math.max(
    0,
    Math.round((input.endTime.getTime() - input.startTime.getTime()) / 60000),
  );

  const currentRows = existing.filter(
    (r) => r.id !== input.excludeScheduleId,
  );
  const currentRaw = toRawDays(input.caregiverId, payRate, currentRows);
  const projectedRaw = [
    ...currentRaw,
    {
      caregiverId: input.caregiverId,
      visitId: input.excludeScheduleId ?? "__proposed__",
      workDate: input.startTime.toISOString().slice(0, 10),
      minutes: proposedMinutes,
      payRate,
    },
  ];

  const empty = (): { reg: number; ot: number; dt: number; cost: number } => ({
    reg: 0,
    ot: 0,
    dt: 0,
    cost: 0,
  });
  const reduce = (rows: RawWorkDay[]) => {
    if (!rule) {
      const total = rows.reduce((s, r) => s + r.minutes, 0);
      return { reg: total, ot: 0, dt: 0, cost: 0 };
    }
    const computed = applyRuleToCaregiverWeek(rule, rows);
    return computed.reduce(
      (acc, e) => ({
        reg: acc.reg + e.regularMinutes,
        ot: acc.ot + e.overtimeMinutes,
        dt: acc.dt + e.doubleTimeMinutes,
        cost: acc.cost + e.overtimePay + e.doubleTimePay,
      }),
      empty(),
    );
  };

  const cur = reduce(currentRaw);
  const proj = reduce(projectedRaw);

  return {
    currentRegularMinutes: cur.reg,
    currentOvertimeMinutes: cur.ot,
    currentDoubleTimeMinutes: cur.dt,
    projectedRegularMinutes: proj.reg,
    projectedOvertimeMinutes: proj.ot,
    projectedDoubleTimeMinutes: proj.dt,
    deltaOvertimeMinutes: proj.ot - cur.ot,
    deltaDoubleTimeMinutes: proj.dt - cur.dt,
    deltaCostUsd: Math.round((proj.cost - cur.cost) * 100) / 100,
    weeklyThresholdMinutes: rule?.overtimeThresholdWeeklyMinutes ?? null,
    dailyThresholdMinutes: rule?.overtimeThresholdDailyMinutes ?? null,
  };
}
