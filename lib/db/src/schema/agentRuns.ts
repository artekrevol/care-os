import {
  pgTable,
  varchar,
  text,
  jsonb,
  integer,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";

export const agentRunsTable = pgTable("agent_runs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  agentName: text("agent_name").notNull(),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("PENDING"),
  triggeredBy: varchar("triggered_by", { length: 64 }),
  triggerReason: text("trigger_reason"),
  inputRef: text("input_ref"),
  inputSummary: text("input_summary"),
  outputRef: text("output_ref"),
  outputSummary: text("output_summary"),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  error: text("error"),
  metadata: jsonb("metadata").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type AgentRun = typeof agentRunsTable.$inferSelect;
