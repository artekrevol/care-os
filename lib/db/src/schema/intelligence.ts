import {
  pgTable,
  varchar,
  text,
  jsonb,
  numeric,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const driveTimeCacheTable = pgTable("drive_time_cache", {
  id: varchar("id", { length: 64 }).primaryKey(),
  originLat: numeric("origin_lat", { precision: 10, scale: 6 }).notNull(),
  originLng: numeric("origin_lng", { precision: 10, scale: 6 }).notNull(),
  destLat: numeric("dest_lat", { precision: 10, scale: 6 }).notNull(),
  destLng: numeric("dest_lng", { precision: 10, scale: 6 }).notNull(),
  bucketHour: integer("bucket_hour").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  distanceMeters: integer("distance_meters").notNull(),
  provider: text("provider").notNull().default("google"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DriveTimeCacheEntry = typeof driveTimeCacheTable.$inferSelect;

export const compatibilityScoresTable = pgTable("compatibility_scores", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 64 }).notNull(),
  caregiverId: varchar("caregiver_id", { length: 64 }).notNull(),
  score: numeric("score", { precision: 5, scale: 2 }).notNull(),
  factors: jsonb("factors").notNull().default({}),
  computedBy: text("computed_by").notNull().default("rule"),
  agentRunId: varchar("agent_run_id", { length: 64 }),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CompatibilityScore =
  typeof compatibilityScoresTable.$inferSelect;

export const anomalyEventsTable = pgTable("anomaly_events", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("LOW"),
  summary: text("summary").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  agentRunId: varchar("agent_run_id", { length: 64 }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: varchar("resolved_by", { length: 64 }),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnomalyEvent = typeof anomalyEventsTable.$inferSelect;

export const authRenewalPredictionsTable = pgTable(
  "auth_renewal_predictions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    agencyId: varchar("agency_id", { length: 64 }).notNull(),
    authorizationId: varchar("authorization_id", { length: 64 }).notNull(),
    predictedRenewalDate: timestamp("predicted_renewal_date", {
      withTimezone: true,
    }),
    riskOfDenial: numeric("risk_of_denial", { precision: 4, scale: 3 }),
    recommendedAction: text("recommended_action"),
    rationale: text("rationale"),
    agentRunId: varchar("agent_run_id", { length: 64 }),
    actedOn: boolean("acted_on").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type AuthRenewalPrediction =
  typeof authRenewalPredictionsTable.$inferSelect;

export const referralDraftsTable = pgTable("referral_drafts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  source: text("source").notNull(),
  sourceMessageId: text("source_message_id"),
  rawContent: text("raw_content"),
  rawAttachmentUrl: text("raw_attachment_url"),
  parsedFields: jsonb("parsed_fields").notNull().default({}),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  status: text("status").notNull().default("DRAFT"),
  promotedClientId: varchar("promoted_client_id", { length: 64 }),
  agentRunId: varchar("agent_run_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ReferralDraft = typeof referralDraftsTable.$inferSelect;
