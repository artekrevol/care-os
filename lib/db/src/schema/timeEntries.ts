import {
  pgTable,
  varchar,
  text,
  numeric,
  integer,
  date,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const timeEntriesTable = pgTable("time_entries", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  caregiverId: varchar("caregiver_id", { length: 64 }).notNull(),
  visitId: varchar("visit_id", { length: 64 }).notNull(),
  payPeriodId: varchar("pay_period_id", { length: 64 }).notNull(),
  workDate: date("work_date").notNull(),
  regularMinutes: integer("regular_minutes").notNull().default(0),
  overtimeMinutes: integer("overtime_minutes").notNull().default(0),
  doubleTimeMinutes: integer("double_time_minutes").notNull().default(0),
  payRate: numeric("pay_rate", { precision: 8, scale: 2 }).notNull(),
  regularPay: numeric("regular_pay", { precision: 10, scale: 2 }).notNull(),
  overtimePay: numeric("overtime_pay", { precision: 10, scale: 2 }).notNull(),
  doubleTimePay: numeric("double_time_pay", { precision: 10, scale: 2 })
    .notNull(),
  travelMinutes: integer("travel_minutes").notNull().default(0),
  travelPay: numeric("travel_pay", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  ruleEngineVersion: text("rule_engine_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  byAgencyPayPeriod: index("time_entries_agency_period_idx").on(t.agencyId, t.payPeriodId),
  byAgencyCaregiver: index("time_entries_agency_caregiver_idx").on(t.agencyId, t.caregiverId),
  byVisitId: index("time_entries_visit_id_idx").on(t.visitId),
}));

export type TimeEntry = typeof timeEntriesTable.$inferSelect;
