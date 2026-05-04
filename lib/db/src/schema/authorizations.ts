import {
  pgTable,
  varchar,
  text,
  date,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const authorizationsTable = pgTable("authorizations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 64 }).notNull(),
  payer: text("payer").notNull(),
  authNumber: text("auth_number").notNull(),
  issuedDate: date("issued_date").notNull(),
  expirationDate: date("expiration_date").notNull(),
  approvedHoursPerWeek: numeric("approved_hours_per_week", {
    precision: 8,
    scale: 2,
  }).notNull(),
  approvedHoursTotal: numeric("approved_hours_total", {
    precision: 10,
    scale: 2,
  }).notNull(),
  hoursUsed: numeric("hours_used", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  scopeOfCare: text("scope_of_care").array().notNull().default([]),
  documentUrl: text("document_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  byAgencyClient: index("auths_agency_client_idx").on(t.agencyId, t.clientId),
  byExpiration: index("auths_expiration_idx").on(t.agencyId, t.expirationDate),
}));

export type AuthorizationRow = typeof authorizationsTable.$inferSelect;
