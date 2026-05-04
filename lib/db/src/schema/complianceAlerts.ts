import {
  pgTable,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const complianceAlertsTable = pgTable("compliance_alerts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  alertType: text("alert_type").notNull(),
  severity: text("severity").notNull().default("MEDIUM"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  suggestedAction: text("suggested_action"),
  status: text("status").notNull().default("OPEN"),
  agentRunId: varchar("agent_run_id", { length: 64 }),
  dedupeKey: varchar("dedupe_key", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  byAgencyStatus: index("alerts_agency_status_idx").on(t.agencyId, t.status),
  byEntityId: index("alerts_entity_id_idx").on(t.entityType, t.entityId),
  byAgencyDedupe: index("alerts_agency_dedupe_idx").on(t.agencyId, t.dedupeKey, t.status),
}));

export type ComplianceAlert = typeof complianceAlertsTable.$inferSelect;
