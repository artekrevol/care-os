import {
  pgTable,
  varchar,
  text,
  date,
  timestamp,
  index,
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
}, (t) => ({
  byAgencyStatus: index("pay_periods_agency_status_idx").on(t.agencyId, t.status),
  byAgencyStart: index("pay_periods_agency_start_idx").on(t.agencyId, t.startDate),
}));

export type PayPeriod = typeof payPeriodsTable.$inferSelect;
