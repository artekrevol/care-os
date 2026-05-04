import {
  pgTable,
  varchar,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
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
  (t) => ({
    byUser: index("notif_prefs_user_id_idx").on(t.userId),
    byType: index("notif_prefs_type_id_idx").on(t.notificationTypeId),
  }),
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
}, (t) => ({
  byUser: index("notif_log_user_id_idx").on(t.userId),
  byType: index("notif_log_type_id_idx").on(t.notificationTypeId),
  byProvider: index("notif_log_provider_msg_idx").on(t.providerMessageId),
}));

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
}, (t) => ({
  byUser: index("push_subs_user_id_idx").on(t.userId),
}));

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
