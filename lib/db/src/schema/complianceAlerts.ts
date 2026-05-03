import {
  pgTable,
  varchar,
  text,
  timestamp,
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
  status: text("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ComplianceAlert = typeof complianceAlertsTable.$inferSelect;
