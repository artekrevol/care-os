import {
  pgTable,
  varchar,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Inbound webhook log. One row per HTTP request to a webhook endpoint
 * (Twilio voice/gather/recording, Resend email events, web push, etc).
 * Persisted before signature validation so rejected requests are still
 * traceable.
 */
export const webhookEventsTable = pgTable(
  "webhook_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    agencyId: varchar("agency_id", { length: 64 }),
    provider: text("provider").notNull(), // "twilio" | "resend" | "push" | other
    route: text("route").notNull(),
    eventType: text("event_type"),
    externalId: text("external_id"), // CallSid, MessageSid, EventId, etc.
    signatureValid: boolean("signature_valid"),
    requestHeaders: jsonb("request_headers").notNull().default({}),
    requestBody: jsonb("request_body").notNull().default({}),
    responseStatus: integer("response_status"),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    byProviderReceived: index("webhook_events_provider_received_idx").on(
      t.provider,
      t.receivedAt,
    ),
    byExternalId: index("webhook_events_external_id_idx").on(t.externalId),
  }),
);

export type WebhookEvent = typeof webhookEventsTable.$inferSelect;

/**
 * Per-attempt delivery record for outbound notifications. Captures every
 * provider call (Resend, Twilio, web-push) regardless of whether it was
 * triggered through `sendNotification` or a direct send (e.g. DLQ alert
 * email). Used by the system-health UI and the critical-channel-failure
 * compliance alert.
 */
export const notificationDeliveriesTable = pgTable(
  "notification_deliveries",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    agencyId: varchar("agency_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }),
    notificationTypeId: varchar("notification_type_id", { length: 64 }),
    channel: text("channel").notNull(), // EMAIL | SMS | PUSH | IN_APP
    provider: text("provider").notNull(), // resend | twilio | webpush | inapp | direct
    recipient: text("recipient"), // email or phone (PII; truncated)
    attempt: integer("attempt").notNull().default(1),
    status: text("status").notNull(), // SENT | FAILED | SKIPPED
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    subject: text("subject"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byAgencyCreated: index("notif_deliveries_agency_created_idx").on(
      t.agencyId,
      t.createdAt,
    ),
    byUserType: index("notif_deliveries_user_type_idx").on(
      t.userId,
      t.notificationTypeId,
    ),
    byProviderMsg: index("notif_deliveries_provider_msg_idx").on(
      t.providerMessageId,
    ),
  }),
);

export type NotificationDelivery =
  typeof notificationDeliveriesTable.$inferSelect;
