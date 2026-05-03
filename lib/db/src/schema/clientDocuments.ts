import {
  pgTable,
  varchar,
  text,
  date,
  numeric,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const clientDocumentsTable = pgTable("client_documents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 64 }).notNull(),
  documentType: text("document_type").notNull(),
  issuedDate: date("issued_date"),
  expirationDate: date("expiration_date"),
  fileObjectKey: text("file_object_key"),
  originalFilename: text("original_filename"),
  classificationStatus: text("classification_status")
    .notNull()
    .default("NONE"),
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
});

export type ClientDocumentRow = typeof clientDocumentsTable.$inferSelect;
