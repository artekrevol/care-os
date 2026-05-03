import {
  pgTable,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

export const messageThreadsTable = pgTable("message_threads", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 64 }),
  caregiverId: varchar("caregiver_id", { length: 64 }),
  topic: text("topic").notNull().default("GENERAL"),
  subject: text("subject"),
  participants: jsonb("participants").notNull().default([]),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MessageThread = typeof messageThreadsTable.$inferSelect;

export const messagesTable = pgTable("messages", {
  id: varchar("id", { length: 64 }).primaryKey(),
  agencyId: varchar("agency_id", { length: 64 }).notNull(),
  threadId: varchar("thread_id", { length: 64 }).notNull(),
  authorId: varchar("author_id", { length: 64 }).notNull(),
  authorRole: text("author_role").notNull(),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  attachments: jsonb("attachments").notNull().default([]),
  redacted: boolean("redacted").notNull().default(false),
  readBy: jsonb("read_by").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Message = typeof messagesTable.$inferSelect;
