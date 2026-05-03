import {
  pgTable,
  varchar,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  userId: varchar("user_id", { length: 64 }),
  userName: text("user_name"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  summary: text("summary").notNull(),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  ipAddress: text("ip_address"),
  timestamp: timestamp("timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLogRow = typeof auditLogTable.$inferSelect;
