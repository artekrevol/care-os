import type { LaborRuleSet } from "@workspace/db";

export interface RawWorkDay {
  caregiverId: string;
  visitId: string;
  workDate: string; // YYYY-MM-DD
  minutes: number;
  payRate: number;
}

export interface ComputedEntry {
  caregiverId: string;
  visitId: string;
  workDate: string;
  regularMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
  payRate: number;
  regularPay: number;
  overtimePay: number;
  doubleTimePay: number;
  totalPay: number;
  ruleEngineVersion: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function dayKey(d: string): string {
  return d;
}

function startOfWeek(d: string): string {
  const date = new Date(d + "T00:00:00Z");
  const day = date.getUTCDay(); // 0 Sun
  const offset = (day + 6) % 7; // Monday-start
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Apply a labor rule set to a list of work days for a single caregiver.
 * Returns one ComputedEntry per input row.
 *
 * Order of operations:
 *   1. Daily double-time threshold (CA: 12h) -> minutes above flip to DT
 *   2. Daily overtime threshold -> remaining minutes above flip to OT
 *   3. Weekly overtime threshold -> sum of REGULAR minutes across the week capped; excess flips to OT
 *   4. Seventh-day rule (CA): if 7 consecutive days were worked in the week, that day's
 *      first 8 hours become OT, anything beyond becomes DT.
 */
export function applyRuleToCaregiverWeek(
  rule: LaborRuleSet,
  rows: RawWorkDay[],
): ComputedEntry[] {
  const otDaily = rule.overtimeThresholdDailyMinutes ?? null;
  const otWeekly = rule.overtimeThresholdWeeklyMinutes ?? null;
  const dtDaily = rule.doubleTimeThresholdDailyMinutes ?? null;
  const seventh = rule.seventhDayConsecutiveRule;

  // Group by day
  const byDay = new Map<string, RawWorkDay[]>();
  for (const r of rows) {
    const k = dayKey(r.workDate);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }

  // Step 1+2: per-day thresholds
  type Bucket = {
    raw: RawWorkDay;
    regular: number;
    overtime: number;
    doubletime: number;
  };
  const buckets: Bucket[] = [];
  const sortedDays = [...byDay.keys()].sort();

  for (const day of sortedDays) {
    const dayRows = byDay.get(day)!;
    let totalDayMinutes = dayRows.reduce((s, r) => s + r.minutes, 0);
    let dayDt = 0;
    let dayOt = 0;
    if (dtDaily != null && totalDayMinutes > dtDaily) {
      dayDt = totalDayMinutes - dtDaily;
      totalDayMinutes = dtDaily;
    }
    if (otDaily != null && totalDayMinutes > otDaily) {
      dayOt = totalDayMinutes - otDaily;
      totalDayMinutes = otDaily;
    }
    const dayReg = totalDayMinutes;

    // Distribute back across rows proportionally (most days have one visit)
    const grossDay = dayRows.reduce((s, r) => s + r.minutes, 0);
    let assignedReg = 0;
    let assignedOt = 0;
    let assignedDt = 0;
    dayRows.forEach((r, idx) => {
      const isLast = idx === dayRows.length - 1;
      const share = grossDay === 0 ? 0 : r.minutes / grossDay;
      const reg = isLast ? dayReg - assignedReg : Math.round(dayReg * share);
      const ot = isLast ? dayOt - assignedOt : Math.round(dayOt * share);
      const dt = isLast ? dayDt - assignedDt : Math.round(dayDt * share);
      assignedReg += reg;
      assignedOt += ot;
      assignedDt += dt;
      buckets.push({
        raw: r,
        regular: Math.max(0, reg),
        overtime: Math.max(0, ot),
        doubletime: Math.max(0, dt),
      });
    });
  }

  // Step 3: weekly OT cap. Group by week and walk in date order.
  if (otWeekly != null) {
    const byWeek = new Map<string, Bucket[]>();
    for (const b of buckets) {
      const w = startOfWeek(b.raw.workDate);
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w)!.push(b);
    }
    for (const [, weekBuckets] of byWeek) {
      weekBuckets.sort((a, b) => a.raw.workDate.localeCompare(b.raw.workDate));
      let weeklyRegSoFar = 0;
      for (const b of weekBuckets) {
        const newTotal = weeklyRegSoFar + b.regular;
        if (newTotal > otWeekly) {
          const overflow = newTotal - otWeekly;
          const flip = Math.min(overflow, b.regular);
          b.regular -= flip;
          b.overtime += flip;
          weeklyRegSoFar += b.regular;
        } else {
          weeklyRegSoFar = newTotal;
        }
      }
    }
  }

  // Step 4: seventh-day rule
  if (seventh) {
    const byWeek = new Map<string, Bucket[]>();
    for (const b of buckets) {
      const w = startOfWeek(b.raw.workDate);
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w)!.push(b);
    }
    for (const [weekStart, weekBuckets] of byWeek) {
      const days = new Set(weekBuckets.map((b) => b.raw.workDate));
      // Check 7 consecutive days from weekStart
      let consecutive = true;
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + i);
        const k = d.toISOString().slice(0, 10);
        if (!days.has(k)) {
          consecutive = false;
          break;
        }
      }
      if (!consecutive) continue;
      // Find the seventh (last) day's buckets
      const seventhDate = new Date(weekStart + "T00:00:00Z");
      seventhDate.setUTCDate(seventhDate.getUTCDate() + 6);
      const seventhKey = seventhDate.toISOString().slice(0, 10);
      const seventhBuckets = weekBuckets.filter(
        (b) => b.raw.workDate === seventhKey,
      );
      const eightHours = 480;
      // Convert this day so first 8h = OT, rest = DT.
      let regulaRemaining = seventhBuckets.reduce((s, b) => s + b.regular, 0);
      let usedToOt = 0;
      for (const b of seventhBuckets) {
        const flipToOt = Math.min(b.regular, Math.max(0, eightHours - usedToOt));
        const flipToDt = b.regular - flipToOt;
        b.regular = 0;
        b.overtime += flipToOt;
        b.doubletime += flipToDt;
        usedToOt += flipToOt;
        regulaRemaining -= flipToOt + flipToDt;
      }
    }
  }

  return buckets.map((b) => {
    const regHrs = b.regular / 60;
    const otHrs = b.overtime / 60;
    const dtHrs = b.doubletime / 60;
    const regPay = round2(regHrs * b.raw.payRate);
    const otPay = round2(otHrs * b.raw.payRate * 1.5);
    const dtPay = round2(dtHrs * b.raw.payRate * 2);
    return {
      caregiverId: b.raw.caregiverId,
      visitId: b.raw.visitId,
      workDate: b.raw.workDate,
      regularMinutes: b.regular,
      overtimeMinutes: b.overtime,
      doubleTimeMinutes: b.doubletime,
      payRate: b.raw.payRate,
      regularPay: regPay,
      overtimePay: otPay,
      doubleTimePay: dtPay,
      totalPay: round2(regPay + otPay + dtPay),
      ruleEngineVersion: `${rule.state}-${rule.version}`,
    };
  });
}

export function applyRule(
  rule: LaborRuleSet,
  rows: RawWorkDay[],
): ComputedEntry[] {
  const byCaregiver = new Map<string, RawWorkDay[]>();
  for (const r of rows) {
    if (!byCaregiver.has(r.caregiverId))
      byCaregiver.set(r.caregiverId, []);
    byCaregiver.get(r.caregiverId)!.push(r);
  }
  const out: ComputedEntry[] = [];
  for (const [, list] of byCaregiver) {
    list.sort((a, b) => a.workDate.localeCompare(b.workDate));
    out.push(...applyRuleToCaregiverWeek(rule, list));
  }
  return out;
}
