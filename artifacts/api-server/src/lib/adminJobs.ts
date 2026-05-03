import express, { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, agentRunsTable } from "@workspace/db";
import { AGENCY_ID } from "./agency";
import { ownerGuard } from "../middlewares/ownerGuard";
import { AGENT_RUNNERS } from "./workers";

/**
 * Admin sub-routes mounted under /admin/jobs/*. Provides:
 *  - GET  /admin/jobs/token-usage  (JSON or HTML)
 *  - POST /admin/jobs/run/:agentName
 * Mounted BEFORE BullBoard so these specific paths win; anything else falls
 * through to the BullBoard router.
 */
export function buildAdminJobsRouter(): IRouter {
  const router: IRouter = Router();

  router.get(
    "/token-usage",
    ownerGuard,
    async (req: Request, res: Response): Promise<void> => {
      const monthsBackRaw = Number(req.query["months"] ?? 6);
      const monthsBack =
        Number.isFinite(monthsBackRaw) && monthsBackRaw > 0
          ? Math.min(24, Math.floor(monthsBackRaw))
          : 6;
      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - monthsBack);
      since.setUTCDate(1);
      since.setUTCHours(0, 0, 0, 0);

      const monthExpr = sql<string>`to_char(${agentRunsTable.startedAt}, 'YYYY-MM')`;
      const rows = await db
        .select({
          month: monthExpr,
          agentName: agentRunsTable.agentName,
          runs: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(${agentRunsTable.inputTokens}),0)::int`,
          outputTokens: sql<number>`coalesce(sum(${agentRunsTable.outputTokens}),0)::int`,
          costUsd: sql<string>`coalesce(sum(${agentRunsTable.costUsd}),0)::text`,
          succeeded: sql<number>`sum(case when ${agentRunsTable.status}='SUCCEEDED' then 1 else 0 end)::int`,
          failed: sql<number>`sum(case when ${agentRunsTable.status}='FAILED' then 1 else 0 end)::int`,
        })
        .from(agentRunsTable)
        .where(
          and(
            eq(agentRunsTable.agencyId, AGENCY_ID),
            gte(agentRunsTable.startedAt, since),
          ),
        )
        .groupBy(monthExpr, agentRunsTable.agentName)
        .orderBy(monthExpr, agentRunsTable.agentName);

      const byMonth = new Map<
        string,
        {
          month: string;
          totalRuns: number;
          totalInputTokens: number;
          totalOutputTokens: number;
          totalCostUsd: number;
          agents: Array<{
            agentName: string;
            runs: number;
            inputTokens: number;
            outputTokens: number;
            costUsd: number;
            succeeded: number;
            failed: number;
          }>;
        }
      >();
      for (const r of rows) {
        const m = byMonth.get(r.month) ?? {
          month: r.month,
          totalRuns: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
          agents: [],
        };
        const cost = Number(r.costUsd);
        m.totalRuns += r.runs;
        m.totalInputTokens += r.inputTokens;
        m.totalOutputTokens += r.outputTokens;
        m.totalCostUsd += cost;
        m.agents.push({
          agentName: r.agentName,
          runs: r.runs,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: Math.round(cost * 1e6) / 1e6,
          succeeded: r.succeeded,
          failed: r.failed,
        });
        byMonth.set(r.month, m);
      }
      const months = Array.from(byMonth.values()).sort((a, b) =>
        b.month.localeCompare(a.month),
      );
      const result = {
        agencyId: AGENCY_ID,
        windowMonths: monthsBack,
        months: months.map((m) => ({
          ...m,
          totalCostUsd: Math.round(m.totalCostUsd * 1e6) / 1e6,
        })),
      };

      const wantsHtml =
        (req.headers["accept"] ?? "").includes("text/html") &&
        req.query["format"] !== "json";
      if (!wantsHtml) {
        res.json(result);
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderTokenUsageHtml(result));
    },
  );

  // POST trigger needs JSON body parsing but bullBoard mounts BEFORE
  // express.json — attach inline.
  router.post(
    "/run/:agentName",
    ownerGuard,
    express.json(),
    async (req: Request, res: Response): Promise<void> => {
      const rawName = req.params["agentName"];
      const name: string = typeof rawName === "string" ? rawName : "";
      const runner = AGENT_RUNNERS[name];
      if (!runner) {
        res.status(404).json({
          error: `unknown agent: ${name}`,
          available: Object.keys(AGENT_RUNNERS),
        });
        return;
      }
      try {
        const result = await runner("manual");
        res.json({ ok: true, agent: name, result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, agent: name, error: msg });
      }
    },
  );

  return router;
}

function renderTokenUsageHtml(data: {
  agencyId: string;
  windowMonths: number;
  months: Array<{
    month: string;
    totalRuns: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    agents: Array<{
      agentName: string;
      runs: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      succeeded: number;
      failed: number;
    }>;
  }>;
}): string {
  const esc = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
    );
  const monthSections = data.months
    .map(
      (m) => `
      <section class="month">
        <header>
          <h2>${esc(m.month)}</h2>
          <div class="totals">
            <span>${m.totalRuns} runs</span>
            <span>${m.totalInputTokens.toLocaleString()} in tok</span>
            <span>${m.totalOutputTokens.toLocaleString()} out tok</span>
            <span>$${m.totalCostUsd.toFixed(4)}</span>
          </div>
        </header>
        <table>
          <thead><tr>
            <th>Agent</th><th>Runs</th><th>OK</th><th>Failed</th>
            <th>Input tok</th><th>Output tok</th><th>Cost USD</th>
          </tr></thead>
          <tbody>
            ${m.agents
              .map(
                (a) => `<tr>
              <td>${esc(a.agentName)}</td>
              <td>${a.runs}</td>
              <td>${a.succeeded}</td>
              <td>${a.failed}</td>
              <td>${a.inputTokens.toLocaleString()}</td>
              <td>${a.outputTokens.toLocaleString()}</td>
              <td>$${a.costUsd.toFixed(4)}</td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </section>`,
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Agent token usage</title>
<style>
  body{font-family:system-ui,sans-serif;margin:2rem;background:#fafafa;color:#1f2937;}
  h1{margin:0 0 .25rem 0;}
  .meta{color:#6b7280;margin-bottom:1.5rem;}
  .month{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;margin-bottom:1rem;}
  .month header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;}
  .month h2{margin:0;font-size:1.1rem;}
  .totals{display:flex;gap:.75rem;color:#374151;font-size:.9rem;}
  .totals span{background:#f3f4f6;border-radius:4px;padding:.15rem .5rem;}
  table{width:100%;border-collapse:collapse;font-size:.9rem;}
  th,td{padding:.4rem .5rem;text-align:left;border-bottom:1px solid #f3f4f6;}
  th{font-weight:600;color:#4b5563;background:#f9fafb;}
  .nav{margin-bottom:1rem;}
  .nav a{color:#2563eb;text-decoration:none;margin-right:1rem;}
</style></head>
<body>
  <div class="nav">
    <a href="/admin/jobs">← BullMQ dashboard</a>
    <a href="?format=json">JSON</a>
  </div>
  <h1>Agent token usage</h1>
  <p class="meta">Agency ${esc(data.agencyId)} · last ${data.windowMonths} month(s)</p>
  ${data.months.length === 0 ? "<p>No agent runs yet.</p>" : monthSections}
</body></html>`;
}
