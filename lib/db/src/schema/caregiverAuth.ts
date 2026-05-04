import {
  pgTable,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";

export const caregiverOtpCodesTable = pgTable("caregiver_otp_codes", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  caregiverId: varchar("caregiver_id", { length: 64 }).notNull(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  byCaregiver: index("otp_codes_caregiver_id_idx").on(t.caregiverId),
}));

export type CaregiverOtpCode = typeof caregiverOtpCodesTable.$inferSelect;

export const caregiverCredentialsTable = pgTable("caregiver_credentials", {
  caregiverId: varchar("caregiver_id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  pinHash: text("pin_hash"),
  pinSalt: text("pin_salt"),
  pinSetAt: timestamp("pin_set_at", { withTimezone: true }),
  pinFailedAttempts: integer("pin_failed_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
  webauthnCredentials: jsonb("webauthn_credentials").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CaregiverCredentials =
  typeof caregiverCredentialsTable.$inferSelect;

export const caregiverSessionsTable = pgTable("caregiver_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  caregiverId: varchar("caregiver_id", { length: 64 }).notNull(),
  tokenHash: text("token_hash").notNull(),
  deviceLabel: text("device_label"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  byCaregiver: index("cg_sessions_caregiver_id_idx").on(t.caregiverId),
}));

export type CaregiverSession = typeof caregiverSessionsTable.$inferSelect;
