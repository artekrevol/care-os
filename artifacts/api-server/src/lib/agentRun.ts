import { eq } from "drizzle-orm";
import { db, agentRunsTable } from "@workspace/db";
import { ai, storage } from "@workspace/services";
import { AGENCY_ID } from "./agency";
import { newId } from "./ids";
import { logger } from "./logger";

export type AgentRunStartInput = {
  agentName: string;
  promptVersion: string;
  model?: string;
  triggeredBy?: string;
  triggerReason?: string;
  inputSummary?: string;
  inputBytes?: Buffer | Uint8Array | string;
  metadata?: Record<string, unknown>;
};

export type AgentRunCompleteInput = {
  outputSummary?: string;
  outputBytes?: Buffer | Uint8Array | string;
  confidence?: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
};

async function uploadIfPresent(
  category: "agent-input" | "agent-output",
  id: string,
  data?: Buffer | Uint8Array | string,
): Promise<string | null> {
  if (!data) return null;
  const bytes =
    typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  const key = storage.buildKey({
    agencyId: AGENCY_ID,
    category,
    id,
    filename: `${category}.json`,
  });
  const ref = await storage.uploadBytes(key, bytes, "application/json");
  return ref?.key ?? null;
}

export async function startAgentRun(
  input: AgentRunStartInput,
): Promise<{ id: string; startedAt: Date }> {
  const id = newId("ar");
  const inputRef = await uploadIfPresent("agent-input", id, input.inputBytes);
  const startedAt = new Date();
  await db.insert(agentRunsTable).values({
    id,
    agencyId: AGENCY_ID,
    agentName: input.agentName,
    promptVersion: input.promptVersion,
    model: input.model ?? "claude-sonnet-4-5",
    status: "RUNNING",
    triggeredBy: input.triggeredBy ?? null,
    triggerReason: input.triggerReason ?? null,
    inputRef,
    inputSummary: input.inputSummary ?? null,
    metadata: input.metadata ?? {},
    startedAt,
  });
  return { id, startedAt };
}

export async function completeAgentRun(
  id: string,
  result: AgentRunCompleteInput,
): Promise<void> {
  const outputRef = await uploadIfPresent(
    "agent-output",
    id,
    result.outputBytes,
  );
  const costUsd =
    result.inputTokens != null && result.outputTokens != null
      ? ai.estimateCostUsd(result.inputTokens, result.outputTokens)
      : null;
  await db
    .update(agentRunsTable)
    .set({
      status: "SUCCEEDED",
      outputRef,
      outputSummary: result.outputSummary ?? null,
      confidence:
        result.confidence != null ? String(result.confidence) : null,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      costUsd: costUsd != null ? String(costUsd) : null,
      latencyMs: result.latencyMs ?? null,
      completedAt: new Date(),
    })
    .where(eq(agentRunsTable.id, id));
}

export async function failAgentRun(id: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ agentRunId: id, err }, "agent run failed");
  await db
    .update(agentRunsTable)
    .set({
      status: "FAILED",
      error: message.slice(0, 2000),
      completedAt: new Date(),
    })
    .where(eq(agentRunsTable.id, id));
}

/**
 * Convenience wrapper: starts a run, executes `fn`, persists results, and
 * returns the function's value plus the run id.
 */
export async function recordAgentRun<T>(
  start: AgentRunStartInput,
  fn: (runId: string) => Promise<{
    value: T;
    outputSummary?: string;
    outputBytes?: Buffer | Uint8Array | string;
    confidence?: number;
    inputTokens?: number;
    outputTokens?: number;
  }>,
): Promise<{ value: T; runId: string }> {
  const { id, startedAt } = await startAgentRun(start);
  try {
    const result = await fn(id);
    await completeAgentRun(id, {
      outputSummary: result.outputSummary,
      outputBytes: result.outputBytes,
      confidence: result.confidence,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - startedAt.getTime(),
    });
    return { value: result.value, runId: id };
  } catch (err) {
    await failAgentRun(id, err);
    throw err;
  }
}
