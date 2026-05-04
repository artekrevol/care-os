import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const familyUsersTable = pgTable("family_users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 64 }).notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  relationship: text("relationship").notNull(),
  accessLevel: text("access_level").notNull().default("VIEWER"),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  invitedBy: varchar("invited_by", { length: 64 }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  inviteToken: text("invite_token"),
  inviteTokenExpiresAt: timestamp("invite_token_expires_at", {
    withTimezone: true,
  }),
  notificationPreferences: jsonb("notification_preferences")
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  byAgencyClient: index("family_users_agency_client_idx").on(t.agencyId, t.clientId),
}));

export type FamilyUser = typeof familyUsersTable.$inferSelect;
