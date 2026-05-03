import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, authorizationsTable, clientsTable } from "@workspace/db";
import { AGENCY_ID } from "../lib/agency";
import { validateSchedule } from "../lib/scheduleValidation";

/**
 * Authorization drawdown race — current behavior pinned.
 *
 * The schedules route validates against `authorizations.hoursUsed`
 * but never atomically updates it. Two concurrent schedule
 * validations against the same authorization can therefore both
 * succeed, even when their combined hours would exceed the
 * authorized total. This test pins that behavior so the moment a
 * fix lands (e.g. SELECT FOR UPDATE on the auth row, or a CHECK
 * constraint on hoursUsed <= approvedHoursTotal), this test will
 * fail and force the contributor to flip the assertion to the
 * post-fix expectation.
 *
 * Setup: insert a fresh client + authorization with only 100h of
 * remaining headroom (hoursUsed=900, approvedHoursTotal=1000).
 * Fire two concurrent validateSchedule() calls each requesting 80h
 * — together 160h, well over the 100h headroom. We assert *neither*
 * call is BLOCKED today. Once drawdown is transactional, exactly
 * one should pass and the other should be BLOCKED.
 */

const TEST_CLIENT_ID = "clt_test_drawdown";
const TEST_AUTH_ID = "auth_test_drawdown";

beforeAll(async () => {
  // Idempotent cleanup so re-runs don't accumulate state.
  await db
    .delete(authorizationsTable)
    .where(eq(authorizationsTable.id, TEST_AUTH_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, TEST_CLIENT_ID));

  await db.insert(clientsTable).values({
    id: TEST_CLIENT_ID,
    agencyId: AGENCY_ID,
    firstName: "Drawdown",
    lastName: "TestClient",
    dob: "1940-01-01",
    phone: "(000) 000-0000",
    addressLine1: "1 Test St",
    city: "Test",
    state: "CA",
    postalCode: "00000",
    primaryPayer: "PRIVATE_PAY",
    status: "ACTIVE",
    intakeDate: "2024-01-01",
    languages: ["English"],
    carePreferences: "test fixture",
    emergencyContactName: "Test",
    emergencyContactPhone: "(000) 000-0000",
  });

  await db.insert(authorizationsTable).values({
    id: TEST_AUTH_ID,
    agencyId: AGENCY_ID,
    clientId: TEST_CLIENT_ID,
    payer: "PRIVATE_PAY",
    authNumber: "TEST-DRAWDOWN-RACE",
    issuedDate: "2024-01-01",
    expirationDate: "2099-12-31",
    approvedHoursPerWeek: "20.00",
    approvedHoursTotal: "1000.00",
    hoursUsed: "900.00",
    scopeOfCare: ["Personal care"],
    documentUrl: null,
  });
});

afterAll(async () => {
  await db
    .delete(authorizationsTable)
    .where(eq(authorizationsTable.id, TEST_AUTH_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, TEST_CLIENT_ID));
});

describe("authorization drawdown race (current behavior pinned)", () => {
  it("two concurrent validations against the same auth both pass even when their combined hours exceed the cap", async () => {
    // 80h each, 8h/day for 10 weekdays, far in the future so neither
    // overlaps the other or any seeded schedule. The two windows are
    // also non-overlapping with each other so we don't trip
    // schedule-conflict logic — the only signal we want is the
    // OUTSIDE_AUTH_HOURS check.
    const baseA = new Date("2099-01-05T08:00:00Z"); // far-future Mon
    const baseB = new Date("2099-03-02T08:00:00Z"); // far-future Mon
    const eightyHours = 80 * 60 * 60 * 1000;

    const args = (start: Date) => ({
      caregiverId: "cg_001",
      clientId: TEST_CLIENT_ID,
      startTime: start,
      endTime: new Date(start.getTime() + eightyHours),
      authorizationId: TEST_AUTH_ID,
    });

    const [c1, c2] = await Promise.all([
      validateSchedule(args(baseA)),
      validateSchedule(args(baseB)),
    ]);

    // Narrow to the specific drawdown signal — credential / overlap
    // BLOCKs are unrelated to the race we're pinning.
    const drawdownBlocks = (
      cs: Awaited<ReturnType<typeof validateSchedule>>,
    ) => cs.filter((c) => c.type === "OUTSIDE_AUTH_HOURS");

    // Today: each call sees hoursUsed=900 in isolation. Each adds
    // 80h, total 980h, under the 1000h cap from its own perspective.
    // Neither raises OUTSIDE_AUTH_HOURS — racy, but pins current
    // behavior. When transactional drawdown lands, exactly one of
    // these should raise OUTSIDE_AUTH_HOURS and this assertion will
    // need to be flipped.
    expect(drawdownBlocks(c1)).toHaveLength(0);
    expect(drawdownBlocks(c2)).toHaveLength(0);

    // Sanity: confirm the validator does still raise
    // OUTSIDE_AUTH_HOURS when a single request alone exceeds the cap
    // (200h > 100h headroom).
    const huge = await validateSchedule({
      caregiverId: "cg_001",
      clientId: TEST_CLIENT_ID,
      startTime: new Date("2099-06-01T08:00:00Z"),
      endTime: new Date(
        new Date("2099-06-01T08:00:00Z").getTime() + 200 * 60 * 60 * 1000,
      ),
      authorizationId: TEST_AUTH_ID,
    });
    expect(drawdownBlocks(huge).length).toBeGreaterThan(0);
  });
});
