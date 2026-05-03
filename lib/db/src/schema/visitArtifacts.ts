import {
  pgTable,
  varchar,
  text,
  jsonb,
  boolean,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";

export const visitChecklistInstancesTable = pgTable(
  "visit_checklist_instances",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    agencyId: varchar("agency_id", { length: 64 }).notNull(),
    visitId: varchar("visit_id", { length: 64 }).notNull(),
    carePlanId: varchar("care_plan_id", { length: 64 }),
    carePlanVersion: integer("care_plan_version"),
    tasks: jsonb("tasks").notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type VisitChecklistInstance =
  typeof visitChecklistInstancesTable.$inferSelect;

export const visitNotesTable = pgTable("visit_notes", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  visitId: varchar("visit_id", { length: 64 }).notNull(),
  authorId: varchar("author_id", { length: 64 }).notNull(),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  voiceClipUrl: text("voice_clip_url"),
  transcribedAt: timestamp("transcribed_at", { withTimezone: true }),
  aiSummary: text("ai_summary"),
  aiAgentRunId: varchar("ai_agent_run_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type VisitNote = typeof visitNotesTable.$inferSelect;

export const visitIncidentsTable = pgTable("visit_incidents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  visitId: varchar("visit_id", { length: 64 }).notNull(),
  reportedBy: varchar("reported_by", { length: 64 }).notNull(),
  severity: text("severity").notNull().default("LOW"),
  category: text("category").notNull(),
  description: text("description").notNull(),
  photoUrls: text("photo_urls").array().notNull().default([]),
  audioUrl: text("audio_url"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: varchar("resolved_by", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type VisitIncident = typeof visitIncidentsTable.$inferSelect;

export const visitSignaturesTable = pgTable("visit_signatures", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  visitId: varchar("visit_id", { length: 64 }).notNull(),
  signerRole: text("signer_role").notNull(),
  signerName: text("signer_name").notNull(),
  signatureSvg: text("signature_svg"),
  signatureImageUrl: text("signature_image_url"),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  capturedLat: text("captured_lat"),
  capturedLng: text("captured_lng"),
  declined: boolean("declined").notNull().default(false),
  declinedReason: text("declined_reason"),
});

export type VisitSignature = typeof visitSignaturesTable.$inferSelect;
