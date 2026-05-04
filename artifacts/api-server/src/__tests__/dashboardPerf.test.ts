import { describe, it, expect } from "vitest";

const BASE = process.env["TEST_API_BASE"] ?? "http://localhost:80";

describe("Dashboard summary — performance regression guard", () => {
  it("returns all expected aggregate fields in a single response", async () => {
    const res = await fetch(`${BASE}/api/dashboard/summary`, {
      headers: { "X-CareOS-Role": "OWNER" },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty("activeClients");
    expect(body).toHaveProperty("activeCaregivers");
    expect(body).toHaveProperty("scheduledVisitsToday");
    expect(body).toHaveProperty("completedVisitsToday");
    expect(body).toHaveProperty("pendingExceptions");
    expect(body).toHaveProperty("openAlerts");
    expect(body).toHaveProperty("expiringAuthorizations");
    expect(body).toHaveProperty("expiringDocuments");
    expect(body).toHaveProperty("weeklyHoursDelivered");
    expect(body).toHaveProperty("weeklyHoursScheduled");
    expect(body).toHaveProperty("projectedWeeklyOvertimeHours");
    expect(body).toHaveProperty("projectedWeeklyOvertimeCost");
    expect(body).toHaveProperty("activeRuleName");
    expect(body).toHaveProperty("activeRuleState");

    expect(typeof body["activeClients"]).toBe("number");
    expect(typeof body["activeCaregivers"]).toBe("number");
    expect(typeof body["scheduledVisitsToday"]).toBe("number");
    expect(typeof body["completedVisitsToday"]).toBe("number");
    expect(typeof body["pendingExceptions"]).toBe("number");
    expect(typeof body["openAlerts"]).toBe("number");
    expect(typeof body["expiringAuthorizations"]).toBe("number");
    expect(typeof body["expiringDocuments"]).toBe("number");
    expect(typeof body["weeklyHoursDelivered"]).toBe("number");
    expect(typeof body["weeklyHoursScheduled"]).toBe("number");
  });

  it("responds within 2 seconds (bounded SQL via Promise.all)", async () => {
    const start = performance.now();
    const res = await fetch(`${BASE}/api/dashboard/summary`, {
      headers: { "X-CareOS-Role": "OWNER" },
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });

  it("executes ≤ 6 SQL statements (real query counter via X-Query-Count header)", async () => {
    const res = await fetch(`${BASE}/api/dashboard/summary`, {
      headers: { "X-CareOS-Role": "OWNER" },
    });
    expect(res.status).toBe(200);

    const countHeader = res.headers.get("X-Query-Count");
    expect(countHeader).toBeTruthy();

    const queryCount = Number(countHeader);
    expect(queryCount).toBeGreaterThan(0);
    expect(queryCount).toBeLessThanOrEqual(6);
  });

  it("has no N+1 loops in the summary handler source", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const src = readFileSync(
      resolve(__dirname, "../routes/dashboard.ts"),
      "utf-8",
    );

    const summaryStart = src.indexOf('"/dashboard/summary"');
    const summaryEnd = src.indexOf('"/dashboard/activity"');
    const summaryHandler = src.slice(summaryStart, summaryEnd);

    expect(summaryHandler).toContain("Promise.all");

    const forLoopQueries =
      summaryHandler.match(/for\s*\(.*\)\s*\{[^}]*\bdb\b/g) ?? [];
    expect(forLoopQueries.length).toBe(0);
  });
});
