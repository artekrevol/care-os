import {
  pgTable,
  varchar,
  text,
  jsonb,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const notificationTypesTable = pgTable("notification_types", {
  id: varchar("id", { length: 64 }).primaryKey(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  defaultChannels: text("default_channels").array().notNull().default([]),
  audienceRoles: text("audience_roles").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
});

export type NotificationType = typeof notificationTypesTable.$inferSelect;

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    agencyId: varchar("agency_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    userRole: text("user_role").notNull(),
    notificationTypeId: varchar("notification_type_id", {
      length: 64,
    }).notNull(),
    channels: text("channels").array().notNull().default([]),
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    timezone: text("timezone"),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type NotificationPreference =
  typeof notificationPreferencesTable.$inferSelect;

export const notificationLogTable = pgTable("notification_log", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  userRole: text("user_role").notNull(),
  notificationTypeId: varchar("notification_type_id", { length: 64 }).notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("QUEUED"),
  payload: jsonb("payload").notNull().default({}),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NotificationLogEntry = typeof notificationLogTable.$inferSelect;

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  userRole: text("user_role").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
