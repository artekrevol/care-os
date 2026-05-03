import { eq } from "drizzle-orm";
import { db, agentRunsTable } from "@workspace/db";
import { ai, queue } from "@workspace/services";
import { completeAgentRun, failAgentRun } from "./agentRun";
import { logger } from "./logger";

type SuggestMetadata = {
  clientName?: string;
  languages?: string[];
  carePreferences?: string | null;
  fallRisk?: string | null;
  cognitiveStatus?: string | null;
  top3?: Array<{
    caregiverId: string;
    name: string;
    score: number;
    factors: unknown;
  }>;
  reasoning?: Array<{ caregiverId: string; text: string }>;
};

export async function runScheduleOptimizerJob(
  agentRunId: string,
): Promise<{ reasoning: Array<{ caregiverId: string; text: string }> }> {
  const [run] = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.id, agentRunId));
  if (!run) throw new Error(`agent run ${agentRunId} not found`);

  const meta = (run.metadata ?? {}) as SuggestMetadata;
  const startedAt = run.startedAt ?? new Date();
  const top3 = meta.top3 ?? [];

  if (top3.length === 0) {
    await completeAgentRun(agentRunId, {
      outputSummary: "no candidates",
      latencyMs: Date.now() - startedAt.getTime(),
    });
    return { reasoning: [] };
  }

  const prompt = `You are CareOS Schedule Optimizer. Given the following caregiver candidates for client ${
    meta.clientName ?? ""
  } (languages: ${(meta.languages ?? []).join(", ") || "none"}, prefs: ${
    meta.carePreferences ?? "none"
  }, fall risk: ${meta.fallRisk ?? "none"}, cognitive: ${
    meta.cognitiveStatus ?? "none"
  }), produce ONE concise sentence (<=240 chars) per caregiver explaining why they are a strong match, citing skills, language, drive time, continuity. Output strictly JSON: { "reasoning": [{"caregiverId": string, "text": string}] }.

CANDIDATES:
${JSON.stringify(top3, null, 2)}`;

  const completion = await ai.complete({
    system:
      "You write crisp, factual scheduler explanations. Always return JSON.",
    prompt,
    maxTokens: 600,
    temperature: 0.2,
  });

  let reasoning: Array<{ caregiverId: string; text: string }> = [];
  try {
    const m = completion.text.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as {
        reasoning?: Array<{ caregiverId: string; text: string }>;
      };
      reasoning = parsed.reasoning ?? [];
    }
  } catch (err) {
    logger.warn({ err }, "schedule-optimizer: reasoning parse failed");
  }

  await db
    .update(agentRunsTable)
    .set({ metadata: { ...meta, reasoning } })
    .where(eq(agentRunsTable.id, agentRunId));

  await completeAgentRun(agentRunId, {
    outputSummary: `LLM reasoning for ${reasoning.length} candidates`,
    outputBytes: JSON.stringify({ reasoning, completionText: completion.text }),
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    latencyMs: Date.now() - startedAt.getTime(),
  });

  return { reasoning };
}

export function registerScheduleOptimizerWorker(): void {
  const w = queue.registerWorker("schedule.suggest-caregivers", async (job) => {
    try {
      await runScheduleOptimizerJob(job.data.agentRunId);
    } catch (err) {
      await failAgentRun(job.data.agentRunId, err);
      throw err;
    }
  });
  if (w) {
    logger.info("schedule.suggest-caregivers worker registered");
  }
}
