import Anthropic from "@anthropic-ai/sdk";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  if (!isModuleConfigured("ai")) return null;
  if (!client) {
    const integrationKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
    const integrationBase = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
    if (integrationKey && integrationBase) {
      client = new Anthropic({
        apiKey: integrationKey,
        baseURL: integrationBase,
      });
    } else {
      client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"]! });
    }
  }
  return client;
}

export const DEFAULT_MODEL = "claude-sonnet-4-5";

export type AICompletionInput = {
  system?: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

export type AICompletionResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  rawId: string;
};

export async function complete(
  input: AICompletionInput,
): Promise<AICompletionResult> {
  const c = getAnthropicClient();
  if (!c) {
    serviceLogger.warn(
      { module: "ai" },
      "Anthropic not configured — returning stub completion",
    );
    return {
      text: "[AI disabled in dev — set ANTHROPIC_API_KEY to enable]",
      model: input.model ?? DEFAULT_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      stopReason: "stub",
      rawId: "stub",
    };
  }
  const resp = await c.messages.create({
    model: input.model ?? DEFAULT_MODEL,
    max_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? 0.2,
    system: input.system,
    messages: [{ role: "user", content: input.prompt }],
  });
  const text = resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return {
    text,
    model: resp.model,
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
    stopReason: resp.stop_reason ?? null,
    rawId: resp.id,
  };
}

// Approximate per-million-token pricing for Sonnet-class models.
const COST_PER_MTOK_INPUT = 3;
const COST_PER_MTOK_OUTPUT = 15;
export function estimateCostUsd(input: number, output: number): number {
  return (
    (input / 1_000_000) * COST_PER_MTOK_INPUT +
    (output / 1_000_000) * COST_PER_MTOK_OUTPUT
  );
}
