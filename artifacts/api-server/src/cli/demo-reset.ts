/**
 * pnpm demo:reset (api-server side) — wipes per-agency Chajinel demo data
 * and reseeds. Connects via the same Postgres pool the server uses and
 * exits when complete. Safe to run while the API server is up.
 *
 * The shared @workspace/scripts trampoline forwards `pnpm demo:reset` from
 * the workspace root to this script.
 */
import { pool } from "@workspace/db";
import { seedDemoFresh } from "../lib/seed";

async function main(): Promise<void> {
  const start = Date.now();
  try {
    await seedDemoFresh();
    const elapsedMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`demo:reset finished in ${(elapsedMs / 1000).toFixed(1)}s`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("demo:reset failed:", err);
  process.exit(1);
});
