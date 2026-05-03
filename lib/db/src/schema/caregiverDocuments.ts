import {
  pgTable,
  varchar,
  text,
  date,
  timestamp,
} from "drizzle-orm/pg-core";

export const caregiverDocumentsTable = pgTable("caregiver_documents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  caregiverId: varchar("caregiver_id", { length: 64 }).notNull(),
  documentType: text("document_type").notNull(),
  issuedDate: date("issued_date"),
  expirationDate: date("expiration_date"),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CaregiverDocumentRow = typeof caregiverDocumentsTable.$inferSelect;
