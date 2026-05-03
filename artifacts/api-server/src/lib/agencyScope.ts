/**
 * Agency-scope guard helpers.
 *
 * The codebase is currently single-agency (`AGENCY_ID = "agency_demo"`),
 * but every agency-scoped table already carries an `agencyId` column.
 * These helpers exist so authors can opt in to a runtime check that a
 * query they are about to run carries an explicit agency filter — and
 * so the multi-tenant test suite has something to exercise before the
 * full per-request agency derivation lands.
 */

/**
 * Throws if the given Drizzle SQL chunk (or compiled query) does not
 * include an `agency_id` predicate. The check is intentionally
 * conservative: it inspects the rendered SQL string for the column
 * name. Authors should pair this with `.where(eq(t.agencyId, ...))`
 * in the same chain.
 *
 * Usage:
 *   const q = db.select().from(clientsTable).where(eq(clientsTable.agencyId, agencyId));
 *   assertAgencyScoped(q.toSQL().sql);
 *   const rows = await q;
 */
export function assertAgencyScoped(renderedSql: string): void {
  const sql = renderedSql.toLowerCase();
  // SELECT * already enumerates "agency_id" as a column, so we cannot
  // just look for the column name anywhere — we need it specifically
  // in (or after) a WHERE clause. Heuristic: the SQL must contain
  // "where" AND "agency_id" must appear at or after that position.
  const whereIdx = sql.indexOf("where");
  if (whereIdx === -1 || !sql.slice(whereIdx).includes("agency_id")) {
    throw new Error(
      "agency-scope guard: query is missing an agency_id predicate. " +
        "Every read/write against an agency-scoped table must filter by " +
        "agencyId. Add .where(eq(<table>.agencyId, agencyId)) to the chain.",
    );
  }
}
