import {
  pgTable,
  varchar,
  text,
  date,
  timestamp,
} from "drizzle-orm/pg-core";

export const clientsTable = pgTable("clients", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dob: date("dob").notNull(),
  phone: text("phone"),
  email: text("email"),
  addressLine1: text("address_line1"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  primaryPayer: text("primary_payer").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  intakeDate: date("intake_date"),
  dischargeDate: date("discharge_date"),
  languages: text("languages").array().notNull().default([]),
  carePreferences: text("care_preferences"),
  allergies: text("allergies"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Client = typeof clientsTable.$inferSelect;
