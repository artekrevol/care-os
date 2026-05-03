import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, count } from "drizzle-orm";
import { db, agentRunsTable, anomalyEventsTable } from "@workspace/db";
import { queue } from "@workspace/services";
import {
  ListAgentRunsQueryParams,
  ListAgentRunsResponse,
  GetAgentRunCostSummaryQueryParams,
  GetAgentRunCostSummaryResponse,
  GetAgentRunParams,
  GetAgentRunResponse,
  RetryAgentRunParams,
  RetryAgentRunResponse,
  ListAnomalyEventsQueryParams,
  ListAnomalyEventsResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { ownerGuard } from "../middlewares/ownerGuard";
import { recordAudit } from "../lib/audit";
import { logger } from "../lib/logger";
import { AGENT_RUNNERS } from "../lib/workers";

const router: IRouter = Router();

const REAL_STATUSES = new Set([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMEOUT",
]);

function normalizeStatus(s: string): string {
  // Legacy seed rows used "COMPLETED"; treat as SUCCEEDED for the API.
  if (s === "COMPLETED") return "SUCCEEDED";
  return s;
}

function fmtRun(r: typeof agentRunsTable.$inferSelect) {
  return {
    id: r.id,
    agentName: r.agentName,
    promptVersion: r.promptVersion,
    model: r.model,
    status: normalizeStatus(r.status),
    triggeredBy: r.triggeredBy,
    triggerReason: r.triggerReason,
    inputRef: r.inputRef,
    inputSummary: r.inputSummary,
    outputRef: r.outputRef,
    outputSummary: r.outputSummary,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    latencyMs: r.latencyMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd != null ? Number(r.costUsd) : null,
    error: r.error,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  };
}

router.get("/agent-runs", async (req, res): Promise<void> => {
  // Express query strings are strings; coerce date-time fields and ensure
  // status is an array even when only one value is supplied (?status=FAILED).
  const raw: Record<string, unknown> = { ...req.query };
  if (typeof raw["status"] === "string") raw["status"] = [raw["status"]];
  if (typeof raw["from"] === "string") raw["from"] = new Date(raw["from"]);
  if (typeof raw["to"] === "string") raw["to"] = new Date(raw["to"]);

  const parsed = ListAgentRunsQueryParams.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const q = parsed.data;
  const conds = [eq(agentRunsTable.agencyId, AGENCY_ID)];
  if (q.agentName) conds.push(eq(agentRunsTable.agentName, q.agentName));

  const realStatuses =
    q.status?.filter((s) => REAL_STATUSES.has(s)) ?? [];
  const wantsLowConf = q.status?.includes("LOW_CONFIDENCE") ?? false;
  // Real statuses and the LOW_CONFIDENCE virtual status are independent
  // selections — operators expect FAILED + LOW_CONFIDENCE to mean "show me
  // either", not their (empty) intersection. Combine with OR.
  const threshold = q.lowConfidenceThreshold ?? 0.7;
  const lowConfClause = sql`(${agentRunsTable.status} = 'SUCCEEDED' AND ${agentRunsTable.confidence} IS NOT NULL AND ${agentRunsTable.confidence} < ${threshold})`;
  if (realStatuses.length > 0 && wantsLowConf) {
    const orClause = or(
      inArray(agentRunsTable.status, realStatuses),
      lowConfClause,
    );
    if (orClause) conds.push(orClause);
  } else if (realStatuses.length > 0) {
    conds.push(inArray(agentRunsTable.status, realStatuses));
  } else if (wantsLowConf) {
    conds.push(lowConfClause);
  }
  if (q.from) conds.push(gte(agentRunsTable.startedAt, q.from));
  if (q.to) conds.push(lte(agentRunsTable.startedAt, q.to));

  const where = and(...conds);
  const [{ total }] = await db
    .select({ total: count() })
    .from(agentRunsTable)
    .where(where);

  const rows = await db
    .select()
    .from(agentRunsTable)
    .where(where)
    .orderBy(desc(agentRunsTable.startedAt))
    .limit(q.limit)
    .offset(q.offset);

  res.json(
    ListAgentRunsResponse.parse({
      items: rows.map(fmtRun),
      total: Number(total ?? 0),
      limit: q.limit,
      offset: q.offset,
    }),
  );
});

router.get("/agent-runs/cost-summary", async (req, res): Promise<void> => {
  const parsed = GetAgentRunCostSummaryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const range = parsed.data.range;
  const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await db
    .select({
      agentName: agentRunsTable.agentName,
      runs: sql<number>`count(*)::int`,
      succeeded: sql<number>`sum(case when ${agentRunsTable.status}='SUCCEEDED' then 1 else 0 end)::int`,
      failed: sql<number>`sum(case when ${agentRunsTable.status} in ('FAILED','TIMEOUT') then 1 else 0 end)::int`,
      avgLatencyMs: sql<string | null>`avg(${agentRunsTable.latencyMs})::text`,
      avgConfidence: sql<string | null>`avg(${agentRunsTable.confidence})::text`,
      inputTokens: sql<number>`coalesce(sum(${agentRunsTable.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${agentRunsTable.outputTokens}),0)::int`,
      costUsd: sql<string>`coalesce(sum(${agentRunsTable.costUsd}),0)::text`,
    })
    .from(agentRunsTable)
    .where(
      and(
        eq(agentRunsTable.agencyId, AGENCY_ID),
        gte(agentRunsTable.startedAt, windowStart),
      ),
    )
    .groupBy(agentRunsTable.agentName)
    .orderBy(agentRunsTable.agentName);

  const byAgent = rows.map((r) => ({
    agentName: r.agentName,
    runs: r.runs,
    succeeded: r.succeeded,
    failed: r.failed,
    avgLatencyMs: r.avgLatencyMs != null ? Number(r.avgLatencyMs) : null,
    avgConfidence: r.avgConfidence != null ? Number(r.avgConfidence) : null,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: Math.round(Number(r.costUsd) * 1e6) / 1e6,
  }));

  const totals = byAgent.reduce(
    (acc, a) => {
      acc.totalRuns += a.runs;
      acc.totalCostUsd += a.costUsd;
      acc.totalInputTokens += a.inputTokens;
      acc.totalOutputTokens += a.outputTokens;
      return acc;
    },
    { totalRuns: 0, totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0 },
  );

  res.json(
    GetAgentRunCostSummaryResponse.parse({
      range,
      windowStart,
      totalRuns: totals.totalRuns,
      totalCostUsd: Math.round(totals.totalCostUsd * 1e6) / 1e6,
      totalInputTokens: totals.totalInputTokens,
      totalOutputTokens: totals.totalOutputTokens,
      byAgent,
    }),
  );
});

router.get("/agent-runs/:id", async (req, res): Promise<void> => {
  const params = GetAgentRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(agentRunsTable)
    .where(
      and(
        eq(agentRunsTable.agencyId, AGENCY_ID),
        eq(agentRunsTable.id, params.data.id),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Agent run not found" });
    return;
  }
  res.json(GetAgentRunResponse.parse(fmtRun(row)));
});

/**
 * Re-trigger an agent run. We do not literally re-run the same job (the input
 * may be stale or already acted on); instead we look up the agent in
 * AGENT_RUNNERS and invoke it with `triggeredBy: retry-of-<runId>` so the
 * fresh attempt is fully audited.
 *
 * Cron-only or queue-only agents (e.g. care-plan, intake) that are not in
 * AGENT_RUNNERS return ok=false with a message — the operator sees this in
 * the UI and can re-enqueue from BullBoard instead.
 */
router.post(
  "/agent-runs/:id/retry",
  ownerGuard,
  async (req, res): Promise<void> => {
    const params = RetryAgentRunParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .select()
      .from(agentRunsTable)
      .where(
        and(
          eq(agentRunsTable.agencyId, AGENCY_ID),
          eq(agentRunsTable.id, params.data.id),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "Agent run not found" });
      return;
    }

    const agentName = row.agentName;
    const runner = AGENT_RUNNERS[agentName];
    const triggeredBy = `retry-of-${row.id}`;

    if (!runner) {
      // Queue-driven agents (referral-parser, document-classifier, anomaly-scan,
      // schedule-optimizer, care-plan-drafter, etc.) cannot be re-run from a
      // bare runId — the original input payload lives on the source row, not
      // here. Map known agent names to their owning queue so the operator gets
      // a precise BullBoard hint; otherwise fall back to a generic hint.
      const queueByAgent: Record<string, queue.QueueName | undefined> = {
        "referral-parser": "ai.intake-referral",
        "document-classifier": "ocr.extract-document",
        "anomaly-scan": "anomaly.scan-visit",
        "schedule-optimizer": "schedule.optimize",
        "care-plan-drafter": "care-plan.generate",
      };
      const qName = queueByAgent[agentName];
      await recordAudit(req.user, {
        action: "AGENT_RUN_RETRY",
        entityType: "agent_run",
        entityId: row.id,
        summary: `${req.user.name} requested retry for queue-driven agent ${agentName}${qName ? ` (queue ${qName})` : ""}`,
      });
      const message = qName
        ? `agent "${agentName}" runs from queue "${qName}" — re-enqueue from /admin/jobs with the original input payload`
        : `agent "${agentName}" is queue-driven; re-enqueue the original job from /admin/jobs (no in-process runner registered)`;
      res.json(
        RetryAgentRunResponse.parse({
          ok: false,
          originalRunId: row.id,
          newRunId: null,
          agentName,
          message,
        }),
      );
      return;
    }

    try {
      const result = (await runner(triggeredBy)) as { runId?: string } | unknown;
      const newRunId =
        result && typeof result === "object" && "runId" in result
          ? ((result as { runId?: string }).runId ?? null)
          : null;
      await recordAudit(req.user, {
        action: "AGENT_RUN_RETRY",
        entityType: "agent_run",
        entityId: row.id,
        summary: `${req.user.name} retried agent ${agentName}${newRunId ? ` (new run ${newRunId})` : ""}`,
        afterState: { newRunId, triggeredBy },
      });
      res.json(
        RetryAgentRunResponse.parse({
          ok: true,
          originalRunId: row.id,
          newRunId,
          agentName,
          message: newRunId
            ? `re-ran ${agentName}; new run ${newRunId}`
            : `re-ran ${agentName} (no new run id reported)`,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, agentName, runId: row.id }, "agent retry failed");
      res.json(
        RetryAgentRunResponse.parse({
          ok: false,
          originalRunId: row.id,
          newRunId: null,
          agentName,
          message: `retry failed: ${msg}`,
        }),
      );
    }
  },
);

// Anomaly events list (kept here to avoid an additional router file).
router.get("/anomaly-events", async (req, res): Promise<void> => {
  const parsed = ListAnomalyEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(anomalyEventsTable.agencyId, AGENCY_ID)];
  if (parsed.data.entityType)
    conds.push(eq(anomalyEventsTable.entityType, parsed.data.entityType));
  if (parsed.data.resolved !== undefined)
    conds.push(
      parsed.data.resolved
        ? isNotNull(anomalyEventsTable.resolvedAt)
        : isNull(anomalyEventsTable.resolvedAt),
    );
  const rows = await db
    .select()
    .from(anomalyEventsTable)
    .where(and(...conds))
    .orderBy(desc(anomalyEventsTable.createdAt))
    .limit(200);
  res.json(ListAnomalyEventsResponse.parse(rows));
});

export default router;
