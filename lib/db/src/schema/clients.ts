import {
  pgTable,
  varchar,
  text,
  date,
  numeric,
  boolean,
  timestamp,
  index,
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
  homeLat: numeric("home_lat", { precision: 10, scale: 6 }),
  homeLng: numeric("home_lng", { precision: 10, scale: 6 }),
  geofenceRadiusMeters: numeric("geofence_radius_meters", {
    precision: 8,
    scale: 2,
  }),
  riskTier: text("risk_tier").notNull().default("STANDARD"),
  fallRisk: text("fall_risk"),
  cognitiveStatus: text("cognitive_status"),
  familyPortalEnabled: boolean("family_portal_enabled")
    .notNull()
    .default(false),
  activeCarePlanId: varchar("active_care_plan_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => ({
  byAgencyStatus: index("clients_agency_status_idx").on(t.agencyId, t.status),
  byActiveCarePlan: index("clients_active_care_plan_idx").on(t.activeCarePlanId),
}));

export type Client = typeof clientsTable.$inferSelect;
