import { pool } from "@workspace/db";

interface AuditRow {
  table_name: string;
  column_name: string;
  status: string;
}

async function run() {
  const { rows } = await pool.query<AuditRow>(`
    WITH fk_cols AS (
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name LIKE '%\\_id' ESCAPE '\\' OR column_name LIKE '%Id')
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
  const missing: AuditRow[] = [];

  for (const row of rows) {
    if (row.status === "COVERED") {
      covered.push(row);
    } else {
      missing.push(row);
    }
  }

  console.log("=== FK/Index Coverage Audit ===\n");

  console.log(`COVERED (${covered.length} columns):`);
  for (const r of covered) {
    console.log(`  + ${r.table_name}.${r.column_name}`);
  }

  console.log(`\nMISSING (${missing.length} columns):`);
  if (missing.length === 0) {
    console.log("  (none -- every FK-like column has a covering index)");
  } else {
    for (const r of missing) {
      console.log(`  x ${r.table_name}.${r.column_name}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total FK-like columns:  ${rows.length}`);
  console.log(`Covered by index:       ${covered.length}`);
  console.log(`Missing index:          ${missing.length}`);

  if (missing.length > 0) {
    console.error("\nFAIL: FK columns without indexes detected.");
    process.exitCode = 1;
  } else {
    console.log("\nPASS: All FK columns have covering indexes.");
  }

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
