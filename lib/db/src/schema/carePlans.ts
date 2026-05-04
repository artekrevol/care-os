import {
  pgTable,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const carePlansTable = pgTable("care_plans", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 64 }).notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("DRAFT"),
  title: text("title").notNull(),
  goals: jsonb("goals").notNull().default([]),
  tasks: jsonb("tasks").notNull().default([]),
  riskFactors: jsonb("risk_factors").notNull().default([]),
  preferences: jsonb("preferences").notNull().default({}),
  effectiveStart: timestamp("effective_start", { withTimezone: true }),
  effectiveEnd: timestamp("effective_end", { withTimezone: true }),
  authoredBy: varchar("authored_by", { length: 64 }),
  submittedBy: varchar("submitted_by", { length: 64 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedBy: varchar("approved_by", { length: 64 }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: varchar("rejected_by", { length: 64 }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  sourceAgentRunId: varchar("source_agent_run_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => ({
  byAgencyClient: index("care_plans_agency_client_idx").on(t.agencyId, t.clientId),
  byAgencyStatus: index("care_plans_agency_status_idx").on(t.agencyId, t.status),
}));

export type CarePlan = typeof carePlansTable.$inferSelect;

export const taskTemplatesTable = pgTable("task_templates", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  defaultMinutes: integer("default_minutes"),
  defaultFrequency: text("default_frequency").notNull().default("PER_VISIT"),
  requiresPhoto: integer("requires_photo").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  ordering: integer("ordering").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TaskTemplate = typeof taskTemplatesTable.$inferSelect;

export const carePlanAcknowledgmentsTable = pgTable(
  "care_plan_acknowledgments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    agencyId: varchar("agency_id", { length: 64 }).notNull(),
    carePlanId: varchar("care_plan_id", { length: 64 }).notNull(),
    familyUserId: varchar("family_user_id", { length: 64 }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
);

export type CarePlanAcknowledgment =
  typeof carePlanAcknowledgmentsTable.$inferSelect;
