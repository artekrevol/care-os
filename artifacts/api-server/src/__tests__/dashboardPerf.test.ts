import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

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

  it("dashboard handler uses Promise.all with ≥11 concurrent DB calls (no N+1)", () => {
    const src = readFileSync(
      resolve(__dirname, "../routes/dashboard.ts"),
      "utf-8",
    );

    const summaryStart = src.indexOf('"/dashboard/summary"');
    const summaryEnd = src.indexOf('"/dashboard/activity"');
    const summaryHandler = src.slice(summaryStart, summaryEnd);

    expect(summaryHandler).toContain("Promise.all");

    const dbCalls = summaryHandler.match(/\bdb\s*\.\s*select\s*\(/g) ?? [];
    expect(dbCalls.length).toBeGreaterThanOrEqual(11);

    const forLoopQueries =
      summaryHandler.match(/for\s*\(.*\)\s*\{[^}]*\bdb\b/g) ?? [];
    expect(forLoopQueries.length).toBe(0);
  });
});
