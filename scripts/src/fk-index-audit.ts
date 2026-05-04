import { pool } from "@workspace/db";

interface AuditRow {
  table_name: string;
  column_name: string;
  status: string;
}

const HOT_PATH_TABLES = new Set([
  "schedules",
  "visits",
  "clients",
  "caregivers",
  "compliance_alerts",
  "authorizations",
  "time_entries",
  "care_plans",
  "caregiver_documents",
  "pay_periods",
  "audit_log",
  "agent_runs",
  "webhook_events",
  "notification_deliveries",
]);

const PHASE2_REFERENCE_ONLY = new Set([
  "audit_log.user_id",
  "care_plans.source_agent_run_id",
  "caregiver_documents.agent_run_id",
  "clients.active_care_plan_id",
  "compliance_alerts.agent_run_id",
  "notification_deliveries.provider_message_id",
  "schedules.optimization_run_id",
  "schedules.parent_schedule_id",
  "visits.care_plan_id",
  "visits.client_signature_id",
  "webhook_events.signature_valid",
]);

async function run() {
  const { rows } = await pool.query<AuditRow>(`
    WITH fk_cols AS (
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name LIKE '%_id' OR column_name LIKE '%Id')
        AND column_name != 'id'
        AND column_name != 'agency_id'
    ),
    idx_cols AS (
      SELECT tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
    )
    SELECT f.table_name, f.column_name,
      CASE WHEN EXISTS (
        SELECT 1 FROM idx_cols i
        WHERE i.tablename = f.table_name
        AND i.indexdef LIKE '%' || f.column_name || '%'
      ) THEN 'COVERED' ELSE 'MISSING'
      END AS status
    FROM fk_cols f
    ORDER BY f.table_name, f.column_name
  `);

  const covered: AuditRow[] = [];
  const missingHotPath: AuditRow[] = [];
  const missingDeferred: AuditRow[] = [];
  const phase2Ref: AuditRow[] = [];

  for (const row of rows) {
    const key = `${row.table_name}.${row.column_name}`;
    if (row.status === "COVERED") {
      covered.push(row);
    } else if (PHASE2_REFERENCE_ONLY.has(key)) {
      phase2Ref.push(row);
    } else if (HOT_PATH_TABLES.has(row.table_name)) {
      missingHotPath.push(row);
    } else {
      missingDeferred.push(row);
    }
  }

  console.log("=== FK/Index Coverage Audit ===\n");

  console.log(`COVERED (${covered.length} columns):`);
  for (const r of covered) {
    console.log(`  + ${r.table_name}.${r.column_name}`);
  }

  console.log(`\nMISSING on HOT-PATH tables (${missingHotPath.length} columns):`);
  if (missingHotPath.length === 0) {
    console.log("  (none -- all hot-path FK columns are indexed)");
  } else {
    for (const r of missingHotPath) {
      console.log(`  x ${r.table_name}.${r.column_name}`);
    }
  }

  console.log(
    `\nPHASE 2 REFERENCE-ONLY on hot-path tables (${phase2Ref.length} columns, write-only or display-only):`,
  );
  for (const r of phase2Ref) {
    console.log(`  ~ ${r.table_name}.${r.column_name}`);
  }

  console.log(
    `\nMISSING on SECONDARY tables (${missingDeferred.length} columns, deferred to follow-up):`,
  );
  for (const r of missingDeferred) {
    console.log(`  - ${r.table_name}.${r.column_name}`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total FK-like columns:          ${rows.length}`);
  console.log(`Covered by index:               ${covered.length}`);
  console.log(`Missing (hot-path queried):      ${missingHotPath.length}`);
  console.log(`Phase 2 reference-only:          ${phase2Ref.length}`);
  console.log(`Missing (secondary, deferred):   ${missingDeferred.length}`);

  if (missingHotPath.length > 0) {
    console.error("\nFAIL: Hot-path FK columns without indexes detected.");
    process.exitCode = 1;
  } else {
    console.log("\nPASS: All hot-path FK columns have covering indexes.");
  }

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
