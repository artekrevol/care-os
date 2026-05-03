import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  caregiversTable,
  schedulesTable,
  visitsTable,
  authorizationsTable,
} from "@workspace/db";
import { AGENCY_ID } from "../lib/agency";

/**
 * Multi-tenant isolation guard.
 *
 * The full Task #38 spec calls for seeding three agencies with
 * overlapping client/caregiver IDs and walking every API surface to
 * assert no cross-tenant reads or writes succeed. The codebase today
 * is intentionally single-agency: every route, query, and worker
 * scopes by the constant `AGENCY_ID = "agency_demo"`. Cross-tenant
 * isolation cannot be exercised until that hard-coded scope is
 * replaced with per-request agency derivation (see follow-up).
 *
 * Until then, this test pins down the *invariant* the single-tenant
 * posture relies on: every row in every agency-scoped table belongs
 * to AGENCY_ID. If a migration or seed regression sneaks in a row
 * with a different agencyId, this test fails — which is exactly the
 * signal we want before any partial multi-tenant change ships.
 */
describe("multi-tenant isolation guard (single-agency invariant)", () => {
  const tables = [
    { name: "clients", t: clientsTable },
    { name: "caregivers", t: caregiversTable },
    { name: "schedules", t: schedulesTable },
    { name: "visits", t: visitsTable },
    { name: "authorizations", t: authorizationsTable },
  ];

  for (const { name, t } of tables) {
    it(`every ${name} row is scoped to ${AGENCY_ID}`, async () => {
      const rows = await db.execute(
        sql`SELECT DISTINCT agency_id FROM ${t}`,
      );
      // drizzle-orm/node-postgres returns { rows: [...] }
      const distinct = (rows as unknown as { rows: { agency_id: string }[] })
        .rows;
      // An empty table is fine — that just means no demo data yet.
      for (const r of distinct) {
        expect(r.agency_id).toBe(AGENCY_ID);
      }
    });
  }

  it("AGENCY_ID is the documented demo constant — flag any drift", () => {
    // If this constant changes, the rest of this test suite (and every
    // route that imports it) must be revisited together. Pinning the
    // value here makes that drift loud.
    expect(AGENCY_ID).toBe("agency_demo");
  });
});
