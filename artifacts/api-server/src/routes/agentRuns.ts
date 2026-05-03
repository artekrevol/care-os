import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, agentRunsTable, anomalyEventsTable } from "@workspace/db";
import {
  ListAgentRunsQueryParams,
  ListAgentRunsResponse,
  GetAgentRunParams,
  GetAgentRunResponse,
  ListAnomalyEventsQueryParams,
  ListAnomalyEventsResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";

const router: IRouter = Router();

function fmtRun(r: typeof agentRunsTable.$inferSelect) {
  return {
    id: r.id,
    agentName: r.agentName,
    promptVersion: r.promptVersion,
    model: r.model,
    status: r.status,
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
  const parsed = ListAgentRunsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(agentRunsTable.agencyId, AGENCY_ID)];
  if (parsed.data.agentName)
    conds.push(eq(agentRunsTable.agentName, parsed.data.agentName));
  if (parsed.data.status)
    conds.push(eq(agentRunsTable.status, parsed.data.status));
  const rows = await db
    .select()
    .from(agentRunsTable)
    .where(and(...conds))
    .orderBy(desc(agentRunsTable.startedAt))
    .limit(100);
  res.json(ListAgentRunsResponse.parse(rows.map(fmtRun)));
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

router.get("/anomaly-events", async (req, res): Promise<void> => {
  const parsed = ListAnomalyEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(anomalyEventsTable.agencyId, AGENCY_ID)];
  if (parsed.data.entityType)
    conds.push(eq(anomalyEventsTable.entityType, parsed.data.entityType));
  const rows = await db
    .select()
    .from(anomalyEventsTable)
    .where(and(...conds))
    .orderBy(desc(anomalyEventsTable.createdAt))
    .limit(100);
  const filtered =
    parsed.data.resolved == null
      ? rows
      : rows.filter((r) =>
          parsed.data.resolved ? r.resolvedAt != null : r.resolvedAt == null,
        );
  res.json(
    ListAnomalyEventsResponse.parse(
      filtered.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        category: r.category,
        severity: r.severity,
        summary: r.summary,
        evidence: (r.evidence ?? {}) as Record<string, unknown>,
        agentRunId: r.agentRunId,
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedBy,
        resolutionNotes: r.resolutionNotes,
        createdAt: r.createdAt,
      })),
    ),
  );
});

export default router;
