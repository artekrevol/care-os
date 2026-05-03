import {
  pgTable,
  varchar,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const schedulesTable = pgTable("schedules", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 64 }).notNull(),
  caregiverId: varchar("caregiver_id", { length: 64 }).notNull(),
  authorizationId: varchar("authorization_id", { length: 64 }),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  scheduledMinutes: integer("scheduled_minutes").notNull(),
  serviceCode: text("service_code").notNull().default("G0156"),
  serviceDescription: text("service_description")
    .notNull()
    .default("Home health aide services, per 15 minutes"),
  status: text("status").notNull().default("SCHEDULED"),
  notes: text("notes"),
  recurrenceRule: text("recurrence_rule"),
  parentScheduleId: varchar("parent_schedule_id", { length: 64 }),
  travelMinutesEstimate: integer("travel_minutes_estimate"),
  optimizationRunId: varchar("optimization_run_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Schedule = typeof schedulesTable.$inferSelect;
