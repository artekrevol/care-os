import { ai } from "@workspace/services";
import type {
  Client,
  AuthorizationRow as Authorization,
  TaskTemplate,
} from "@workspace/db";
import { recordAgentRun } from "./agentRun";
import { newId } from "./ids";

export type CarePlanDraft = {
  title: string;
  goals: Array<{ id: string; title: string; description?: string }>;
  tasks: Array<{
    id: string;
    templateId: string | null;
    category: string;
    title: string;
    instructions: string | null;
    frequency: "DAILY" | "WEEKLY" | "PER_VISIT" | "PRN";
    ordering: number;
    requiresPhoto: boolean;
  }>;
  riskFactors: string[];
  preferences: Record<string, unknown>;
  agentRunId: string;
};

const PROMPT_VERSION = "care-plan-drafter@2026-05-01";

const SYSTEM_PROMPT = `You are a Care Plan Drafter for a US home-care agency.
Given a client and an authorization scope of care, you select an appropriate
starter set of tasks from a provided template library and propose goals.

Rules:
- Output STRICT JSON, no prose, no markdown fences.
- Pick 6–14 templates that best match the authorization scope. Prefer
  templates whose category matches the requested scope keywords (ADL,
  IADL, MEAL, MEDICATION, AMBULATION, COMPANIONSHIP, SAFETY).
- Use the template's defaultFrequency unless authorization context strongly
  suggests otherwise.
- Goals should be 2–4 short, measurable statements tied to the scope.
- Risk factors mirror the client's known fall/cognitive risks if present.
- Never invent medications or clinical procedures.`;

function buildPrompt(input: {
  client: Client;
  authorization: Authorization;
  templates: TaskTemplate[];
}): string {
  const tplLines = input.templates
    .map(
      (t) =>
        `- id=${t.id} | ${t.category} | ${t.title} | freq=${t.defaultFrequency}${t.description ? ` | ${t.description}` : ""}`,
    )
    .join("\n");
  const scope = (input.authorization.scopeOfCare ?? []).join(", ") || "general home-care support";
  return `Client: ${input.client.firstName} ${input.client.lastName}
Risk tier: ${input.client.riskTier}
Fall risk: ${input.client.fallRisk ?? "unknown"}
Cognitive: ${input.client.cognitiveStatus ?? "unknown"}
Languages: ${(input.client.languages ?? []).join(", ") || "EN"}
Care preferences: ${input.client.carePreferences ?? "none on file"}

Authorization payer: ${input.authorization.payer}
Approved hours/week: ${input.authorization.approvedHoursPerWeek}
Scope of care keywords: ${scope}

TEMPLATE LIBRARY:
${tplLines}

Return JSON:
{
  "title": string,
  "goals": [{ "title": string, "description": string }],
  "tasks": [
    { "templateId": string, "frequency": "DAILY"|"WEEKLY"|"PER_VISIT"|"PRN", "instructions": string }
  ],
  "riskFactors": [string]
}`;
}

function fallbackDraft(input: {
  client: Client;
  authorization: Authorization;
  templates: TaskTemplate[];
}): Omit<CarePlanDraft, "agentRunId"> {
  // Heuristic library-matched starter when AI is disabled.
  const scope: string[] = ((input.authorization.scopeOfCare ?? []) as string[]).map(
    (s: string) => s.toUpperCase(),
  );
  const wanted = new Set<string>();
  if (scope.some((s: string) => s.includes("ADL"))) wanted.add("ADL");
  if (scope.some((s: string) => s.includes("IADL") || s.includes("HOUSE"))) wanted.add("IADL");
  if (scope.some((s: string) => s.includes("MEAL"))) wanted.add("MEAL");
  if (scope.some((s: string) => s.includes("MED"))) wanted.add("MEDICATION");
  if (scope.some((s: string) => s.includes("AMBUL") || s.includes("MOBIL"))) wanted.add("AMBULATION");
  if (scope.some((s: string) => s.includes("COMPAN"))) wanted.add("COMPANIONSHIP");
  if (wanted.size === 0) {
    ["ADL", "MEAL", "COMPANIONSHIP", "SAFETY"].forEach((c) => wanted.add(c));
  }
  const picks: TaskTemplate[] = [];
  for (const cat of wanted) {
    const fromCat = input.templates
      .filter((t) => t.category === cat)
      .slice(0, 3);
    picks.push(...fromCat);
  }
  // Always include safety check
  const safety = input.templates.find((t) => t.category === "SAFETY");
  if (safety && !picks.find((p) => p.id === safety.id)) picks.push(safety);

  return {
    title: `Starter care plan — ${input.client.firstName} ${input.client.lastName}`,
    goals: [
      {
        id: newId("cpg"),
        title: "Maintain safety at home",
        description: "Zero falls and zero missed medications during plan period.",
      },
      {
        id: newId("cpg"),
        title: "Support activities of daily living",
        description: "Client retains dignity and independence with stand-by assist.",
      },
    ],
    tasks: picks.map((t, idx) => ({
      id: newId("cpt"),
      templateId: t.id,
      category: t.category,
      title: t.title,
      instructions: t.description ?? null,
      frequency: t.defaultFrequency as CarePlanDraft["tasks"][0]["frequency"],
      ordering: idx,
      requiresPhoto: t.requiresPhoto === 1,
    })),
    riskFactors: [
      ...(input.client.fallRisk ? [`Fall risk: ${input.client.fallRisk}`] : []),
      ...(input.client.cognitiveStatus
        ? [`Cognitive status: ${input.client.cognitiveStatus}`]
        : []),
    ],
    preferences: {
      languages: input.client.languages ?? [],
      notes: input.client.carePreferences ?? null,
    },
  };
}

export async function draftCarePlanFromAuthorization(input: {
  client: Client;
  authorization: Authorization;
  templates: TaskTemplate[];
}): Promise<CarePlanDraft> {
  const prompt = buildPrompt(input);
  const { value, runId } = await recordAgentRun(
    {
      agentName: "care-plan-drafter",
      promptVersion: PROMPT_VERSION,
      triggerReason: `auth ${input.authorization.id}`,
      inputSummary: `Draft plan for ${input.client.firstName} ${input.client.lastName}`,
      inputBytes: prompt,
      // Retry uses the source authorization id to redraft.
      metadata: {
        inputPayload: {
          authorizationId: input.authorization.id,
          clientId: input.client.id,
        },
      },
    },
    async () => {
      const completion = await ai.complete({
        system: SYSTEM_PROMPT,
        prompt,
        maxTokens: 1500,
      });
      let parsed: {
        title?: string;
        goals?: Array<{ title?: string; description?: string }>;
        tasks?: Array<{
          templateId?: string;
          frequency?: string;
          instructions?: string;
        }>;
        riskFactors?: string[];
      } | null = null;
      try {
        const trimmed = completion.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
      const fb = fallbackDraft(input);
      let draft: Omit<CarePlanDraft, "agentRunId">;
      if (parsed?.tasks?.length) {
        const byId = new Map(input.templates.map((t) => [t.id, t]));
        const tasks = (parsed.tasks ?? [])
          .map((t, idx) => {
            const tpl = t.templateId ? byId.get(t.templateId) : undefined;
            if (!tpl) return null;
            const freq = (
              ["DAILY", "WEEKLY", "PER_VISIT", "PRN"] as const
            ).includes(t.frequency as never)
              ? (t.frequency as CarePlanDraft["tasks"][0]["frequency"])
              : (tpl.defaultFrequency as CarePlanDraft["tasks"][0]["frequency"]);
            return {
              id: newId("cpt"),
              templateId: tpl.id,
              category: tpl.category,
              title: tpl.title,
              instructions: t.instructions ?? tpl.description ?? null,
              frequency: freq,
              ordering: idx,
              requiresPhoto: tpl.requiresPhoto === 1,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        draft = {
          title: parsed.title ?? fb.title,
          goals: (parsed.goals ?? []).map((g) => ({
            id: newId("cpg"),
            title: g.title ?? "Goal",
            description: g.description,
          })),
          tasks: tasks.length ? tasks : fb.tasks,
          riskFactors: parsed.riskFactors ?? fb.riskFactors,
          preferences: fb.preferences,
        };
      } else {
        draft = fb;
      }
      return {
        value: draft,
        outputSummary: `${draft.tasks.length} tasks, ${draft.goals.length} goals`,
        outputBytes: JSON.stringify(draft, null, 2),
        confidence: parsed ? 0.75 : 0.4,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      };
    },
  );
  return { ...value, agentRunId: runId };
}
