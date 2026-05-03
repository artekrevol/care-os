import {
  pgTable,
  varchar,
  text,
  date,
  numeric,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const caregiversTable = pgTable("caregivers", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  employmentType: text("employment_type").notNull().default("W2"),
  hireDate: date("hire_date"),
  terminationDate: date("termination_date"),
  status: text("status").notNull().default("ACTIVE"),
  languages: text("languages").array().notNull().default([]),
  skills: text("skills").array().notNull().default([]),
  payRate: numeric("pay_rate", { precision: 8, scale: 2 }).notNull(),
  hasVehicle: boolean("has_vehicle").notNull().default(true),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  homeLat: numeric("home_lat", { precision: 10, scale: 6 }),
  homeLng: numeric("home_lng", { precision: 10, scale: 6 }),
  userId: varchar("user_id", { length: 64 }),
  pwaInstalled: boolean("pwa_installed").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  compatibilityTags: text("compatibility_tags").array().notNull().default([]),
  certifications: text("certifications").array().notNull().default([]),
  preferredRadiusMiles: numeric("preferred_radius_miles", {
    precision: 5,
    scale: 1,
  }),
  ratingAverage: numeric("rating_average", { precision: 3, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Caregiver = typeof caregiversTable.$inferSelect;
