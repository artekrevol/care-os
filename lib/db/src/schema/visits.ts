import {
  pgTable,
  varchar,
  text,
  numeric,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const visitsTable = pgTable("visits", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  scheduleId: varchar("schedule_id", { length: 64 }),
  caregiverId: varchar("caregiver_id", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 64 }).notNull(),
  clockInTime: timestamp("clock_in_time", { withTimezone: true }),
  clockInLat: numeric("clock_in_lat", { precision: 10, scale: 6 }),
  clockInLng: numeric("clock_in_lng", { precision: 10, scale: 6 }),
  clockInMethod: text("clock_in_method").notNull().default("GPS"),
  clockOutTime: timestamp("clock_out_time", { withTimezone: true }),
  clockOutLat: numeric("clock_out_lat", { precision: 10, scale: 6 }),
  clockOutLng: numeric("clock_out_lng", { precision: 10, scale: 6 }),
  clockOutMethod: text("clock_out_method").notNull().default("GPS"),
  durationMinutes: integer("duration_minutes"),
  tasksCompleted: text("tasks_completed").array().notNull().default([]),
  caregiverNotes: text("caregiver_notes"),
  supervisorNotes: text("supervisor_notes"),
  verificationStatus: text("verification_status").notNull().default("PENDING"),
  exceptionReason: text("exception_reason"),
  geoFenceMatch: boolean("geo_fence_match").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Visit = typeof visitsTable.$inferSelect;
