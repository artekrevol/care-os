import {
  pgTable,
  varchar,
  text,
  date,
  timestamp,
} from "drizzle-orm/pg-core";

export const payPeriodsTable = pgTable("pay_periods", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: text("status").notNull().default("OPEN"),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PayPeriod = typeof payPeriodsTable.$inferSelect;
