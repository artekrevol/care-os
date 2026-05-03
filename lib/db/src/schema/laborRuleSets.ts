import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const laborRuleSetsTable = pgTable("labor_rule_sets", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  state: text("state").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  version: text("version").notNull().default("1.0.0"),
  overtimeThresholdDailyMinutes: integer("ot_daily_minutes"),
  overtimeThresholdWeeklyMinutes: integer("ot_weekly_minutes"),
  doubleTimeThresholdDailyMinutes: integer("dt_daily_minutes"),
  seventhDayConsecutiveRule: boolean("seventh_day_rule")
    .notNull()
    .default(false),
  travelTimeBillable: boolean("travel_time_billable").notNull().default(false),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LaborRuleSet = typeof laborRuleSetsTable.$inferSelect;
