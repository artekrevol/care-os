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

export const caregiverDocumentsTable = pgTable("caregiver_documents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  caregiverId: varchar("caregiver_id", { length: 64 }).notNull(),
  documentType: text("document_type").notNull(),
  issuedDate: date("issued_date"),
  expirationDate: date("expiration_date"),
  fileUrl: text("file_url"),
  fileObjectKey: text("file_object_key"),
  originalFilename: text("original_filename"),
  classificationStatus: text("classification_status")
    .notNull()
    .default("NONE"), // NONE | PENDING | RUNNING | DONE | FAILED
  classifiedType: text("classified_type"),
  classificationConfidence: numeric("classification_confidence", {
    precision: 4,
    scale: 3,
  }),
  needsReview: boolean("needs_review").notNull().default(false),
  agentRunId: varchar("agent_run_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  byAgencyCaregiver: index("cg_docs_agency_caregiver_idx").on(t.agencyId, t.caregiverId),
  byAgencyExpiration: index("cg_docs_agency_expiration_idx").on(t.agencyId, t.expirationDate),
  byAgentRun: index("cg_docs_agent_run_idx").on(t.agentRunId),
}));

export type CaregiverDocumentRow = typeof caregiverDocumentsTable.$inferSelect;
