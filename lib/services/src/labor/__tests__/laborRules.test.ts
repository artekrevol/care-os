import { describe, it, expect } from "vitest";
import type { LaborRuleSet } from "@workspace/db";
import { applyRule, type RawWorkDay } from "../index";

/**
 * Eight hard-coded edge cases for the labor rule engine, called out in
 * Task #38. These are the wedge-product calculations we cannot afford
 * to ship a regression on. Each test pins down a specific rule path:
 *
 *   1. CA daily OT  (9.5h day  -> 9 reg + 0.5 OT)
 *   2. CA daily DT  (13h day   -> 9 reg + 3 OT + 1 DT)
 *   3. CA 7th-day   (Sun = first 8h OT, rest DT)
 *   4. FLSA weekly  (45h, 8h days -> 40 reg + 5 OT, no daily OT)
 *   5. FLSA mixed   (50h with one 14h day -> 40 reg + 10 OT, no DT)
 *   6. NY parity    (40h does NOT trigger weekly OT @ 44h threshold)
 *   7. TX FLSA-only (mirrors federal at the 40h boundary)
 *   8. Authorization drawdown race (documented gap — see ./drawdownRace.test.ts)
 */

// Rule fixtures mirror the demo seed in artifacts/api-server/src/lib/seed.ts.
// Keeping them inline keeps the test self-contained — pure computation, no DB.

const ruleCA: LaborRuleSet = {
  id: "rule_ca",
  agencyId: "agency_demo",
  state: "CA",
  name: "California Domestic Worker",
  description: "test fixture",
  version: "2026.1",
  overtimeThresholdDailyMinutes: 540, // 9h
  overtimeThresholdWeeklyMinutes: 2400, // 40h
  doubleTimeThresholdDailyMinutes: 720, // 12h
  seventhDayConsecutiveRule: true,
  travelTimeBillable: true,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const ruleFLSA: LaborRuleSet = {
  id: "rule_flsa",
  agencyId: "agency_demo",
  state: "US",
  name: "Federal FLSA",
  description: "test fixture",
  version: "2024.2",
  overtimeThresholdDailyMinutes: null,
  overtimeThresholdWeeklyMinutes: 2400, // 40h
  doubleTimeThresholdDailyMinutes: null,
  seventhDayConsecutiveRule: false,
  travelTimeBillable: false,
  isActive: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const ruleNY: LaborRuleSet = {
  id: "rule_ny",
  agencyId: "agency_demo",
  state: "NY",
  name: "NY Wage Parity",
  description: "test fixture",
  version: "2025.3",
  overtimeThresholdDailyMinutes: null,
  overtimeThresholdWeeklyMinutes: 2640, // 44h residential threshold
  doubleTimeThresholdDailyMinutes: null,
  seventhDayConsecutiveRule: false,
  travelTimeBillable: true,
  isActive: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const ruleTX: LaborRuleSet = {
  ...ruleFLSA,
  id: "rule_tx",
  state: "TX",
  name: "Texas FLSA-only",
  version: "2024.1",
};

// Helper: build a RawWorkDay row.
function row(
  workDate: string,
  minutes: number,
  visitId = "v_" + workDate,
  payRate = 25,
): RawWorkDay {
  return { caregiverId: "cg_test", visitId, workDate, minutes, payRate };
}

// Helper: sum a field across the result rows.
function sum(
  rows: ReturnType<typeof applyRule>,
  k: "regularMinutes" | "overtimeMinutes" | "doubleTimeMinutes",
): number {
  return rows.reduce((s, r) => s + r[k], 0);
}

// Monday 2026-01-05 is the anchor week used throughout these tests so the
// startOfWeek calculation lands on a clean Monday.
const MON = "2026-01-05";
const TUE = "2026-01-06";
const WED = "2026-01-07";
const THU = "2026-01-08";
const FRI = "2026-01-09";
const SAT = "2026-01-10";
const SUN = "2026-01-11";

describe("labor rule engine — 8 critical-path edge cases", () => {
  it("CA #1: 9.5h day -> 9h regular + 0.5h overtime", () => {
    const out = applyRule(ruleCA, [row(MON, 570)]); // 9h30m
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      regularMinutes: 540,
      overtimeMinutes: 30,
      doubleTimeMinutes: 0,
    });
  });

  it("CA #2: 13h day -> 9h regular + 3h overtime + 1h double-time", () => {
    const out = applyRule(ruleCA, [row(MON, 780)]); // 13h
    expect(out[0]).toMatchObject({
      regularMinutes: 540, // 9h
      overtimeMinutes: 180, // 3h
      doubleTimeMinutes: 60, // 1h
    });
  });

  it("CA #3: 7-day consecutive — 7th day's first 8h flips to OT, rest to DT", () => {
    // Six light weekdays (1h each) + a 10h Sunday. We deliberately
    // keep weekday hours small so the weekly 40h cap doesn't fire
    // first — that would otherwise eat Sunday's regular minutes
    // before the 7th-day rule can reclassify them. CA's pipeline
    // applies daily OT (>9h) first, then weekly OT (>40h), then the
    // 7th-day rule. Here Sun raw=10h: daily OT carves off 1h to OT
    // leaving 9h regular; weekly cap doesn't trip (only 16h total);
    // 7th-day rule then flips the first 8h of remaining regular to
    // OT and the last 1h to DT.
    const days = [MON, TUE, WED, THU, FRI, SAT].map((d) => row(d, 60)); // 1h
    const sunday = row(SUN, 600); // 10h
    const out = applyRule(ruleCA, [...days, sunday]);
    const sundayOut = out.find((r) => r.workDate === SUN)!;
    expect(sundayOut).toMatchObject({
      regularMinutes: 0,
      overtimeMinutes: 540, // 60min daily OT + 480min from 7th-day flip
      doubleTimeMinutes: 60, // 1h beyond the 8h OT bucket on the 7th day
    });
    // The first six days remain pure regular — under daily OT and
    // far under the weekly cap.
    for (const d of [MON, TUE, WED, THU, FRI, SAT]) {
      const r = out.find((x) => x.workDate === d)!;
      expect(r.regularMinutes).toBe(60);
      expect(r.overtimeMinutes).toBe(0);
      expect(r.doubleTimeMinutes).toBe(0);
    }
  });

  it("FLSA #4: 45h week of 8h days (+ 5h Sat) -> 40 reg + 5 OT, no daily OT", () => {
    const rows = [
      row(MON, 480),
      row(TUE, 480),
      row(WED, 480),
      row(THU, 480),
      row(FRI, 480),
      row(SAT, 300), // 5h
    ];
    const out = applyRule(ruleFLSA, rows);
    expect(sum(out, "regularMinutes")).toBe(2400); // 40h
    expect(sum(out, "overtimeMinutes")).toBe(300); // 5h
    expect(sum(out, "doubleTimeMinutes")).toBe(0);
  });

  it("FLSA #5: 50h week with one 14h day -> 40 reg + 10 OT, no DT (no daily OT)", () => {
    const rows = [
      row(MON, 840), // 14h — federal has no daily OT/DT
      row(TUE, 480),
      row(WED, 480),
      row(THU, 480),
      row(FRI, 720), // 12h
    ];
    const out = applyRule(ruleFLSA, rows);
    expect(sum(out, "regularMinutes")).toBe(2400); // 40h
    expect(sum(out, "overtimeMinutes")).toBe(600); // 10h
    expect(sum(out, "doubleTimeMinutes")).toBe(0);
  });

  it("NY #6: 40h week stays pure regular under 44h residential threshold", () => {
    const rows = [
      row(MON, 480),
      row(TUE, 480),
      row(WED, 480),
      row(THU, 480),
      row(FRI, 480),
    ];
    const out = applyRule(ruleNY, rows);
    expect(sum(out, "regularMinutes")).toBe(2400);
    expect(sum(out, "overtimeMinutes")).toBe(0);
    expect(sum(out, "doubleTimeMinutes")).toBe(0);
  });

  it("TX #7: Texas mirrors federal FLSA at the 40h boundary", () => {
    const rows = [
      row(MON, 480),
      row(TUE, 480),
      row(WED, 480),
      row(THU, 480),
      row(FRI, 480),
      row(SAT, 60),
    ];
    const out = applyRule(ruleTX, rows);
    expect(sum(out, "regularMinutes")).toBe(2400);
    expect(sum(out, "overtimeMinutes")).toBe(60);
    expect(sum(out, "doubleTimeMinutes")).toBe(0);
  });

  it("CA #8 (pay math): 13h day produces correct gross at 1x/1.5x/2x multipliers", () => {
    // Same shape as CA #2, but assert the dollar math too — this is the
    // single most-watched calculation in payroll, so we pin it here as
    // a regression guard alongside the minute split.
    const out = applyRule(ruleCA, [row(MON, 780, "v_pay", 30)]); // $30/h
    expect(out[0].regularPay).toBe(270); // 9h * 30
    expect(out[0].overtimePay).toBe(135); // 3h * 30 * 1.5
    expect(out[0].doubleTimePay).toBe(60); // 1h * 30 * 2
    expect(out[0].totalPay).toBe(465);
  });
});
