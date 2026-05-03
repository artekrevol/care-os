import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  messageThreadsTable,
  messagesTable,
} from "@workspace/db";
import {
  ListMessageThreadsQueryParams,
  ListMessageThreadsResponse,
  CreateMessageThreadBody,
  ListThreadMessagesParams,
  ListThreadMessagesResponse,
  PostThreadMessageParams,
  PostThreadMessageBody,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import {
  loadFamilyCaller,
  assertFamilyThreadAccess,
} from "../lib/familyAuth";

const router: IRouter = Router();

function formatThread(t: typeof messageThreadsTable.$inferSelect) {
  return {
    id: t.id,
    clientId: t.clientId,
    caregiverId: t.caregiverId,
    topic: t.topic,
    subject: t.subject,
    participants: (t.participants as Array<{
      userId: string;
      role: string;
      name: string;
    }>) ?? [],
    lastMessageAt: t.lastMessageAt,
    closedAt: t.closedAt,
    createdAt: t.createdAt,
  };
}

function formatMessage(m: typeof messagesTable.$inferSelect) {
  return {
    id: m.id,
    threadId: m.threadId,
    authorId: m.authorId,
    authorRole: m.authorRole,
    authorName: m.authorName,
    body: m.body,
    attachments: (m.attachments as Array<Record<string, unknown>>) ?? [],
    redacted: m.redacted,
    readBy: (m.readBy as string[]) ?? [],
    createdAt: m.createdAt,
  };
}

router.get("/message-threads", async (req, res): Promise<void> => {
  const parsed = ListMessageThreadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(messageThreadsTable.agencyId, AGENCY_ID)];
  if (req.header("x-family-user-id")) {
    const fam = await loadFamilyCaller(req);
    if (!fam) {
      res.status(401).json({ error: "Unknown family user" });
      return;
    }
    conds.push(eq(messageThreadsTable.clientId, fam.clientId));
  } else {
    if (parsed.data.clientId)
      conds.push(eq(messageThreadsTable.clientId, parsed.data.clientId));
    if (parsed.data.caregiverId)
      conds.push(eq(messageThreadsTable.caregiverId, parsed.data.caregiverId));
  }
  const rows = await db
    .select()
    .from(messageThreadsTable)
    .where(and(...conds))
    .orderBy(desc(messageThreadsTable.lastMessageAt));
  let result = rows;
  if (req.header("x-family-user-id")) {
    const fam = await loadFamilyCaller(req);
    result = rows.filter((t) => {
      const ps = (t.participants as Array<{ userId: string }>) ?? [];
      return ps.some((p) => p.userId === fam?.userId);
    });
  }
  res.json(ListMessageThreadsResponse.parse(result.map(formatThread)));
});

router.post("/message-threads", async (req, res): Promise<void> => {
  const parsed = CreateMessageThreadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (req.header("x-family-user-id")) {
    const fam = await loadFamilyCaller(req);
    if (!fam) {
      res.status(401).json({ error: "Unknown family user" });
      return;
    }
    if (parsed.data.clientId && parsed.data.clientId !== fam.clientId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const isParticipant = parsed.data.participants.some(
      (p) => p.userId === fam.userId,
    );
    if (!isParticipant) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  const id = newId("thr");
  const now = new Date();
  const [thread] = await db
    .insert(messageThreadsTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      clientId: parsed.data.clientId ?? null,
      caregiverId: parsed.data.caregiverId ?? null,
      topic: parsed.data.topic ?? "GENERAL",
      subject: parsed.data.subject ?? null,
      participants: parsed.data.participants,
      lastMessageAt: parsed.data.initialMessage ? now : null,
    })
    .returning();
  if (parsed.data.initialMessage) {
    const im = parsed.data.initialMessage;
    await db.insert(messagesTable).values({
      id: newId("msg"),
      agencyId: AGENCY_ID,
      threadId: thread.id,
      authorId: im.authorId,
      authorRole: im.authorRole,
      authorName: im.authorName,
      body: im.body,
      attachments: [],
      readBy: [im.authorId],
    });
  }
  res.status(201).json(formatThread(thread));
});

router.get(
  "/message-threads/:id/messages",
  async (req, res): Promise<void> => {
    const params = ListThreadMessagesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await assertFamilyThreadAccess(req, res, params.data.id))) return;
    const rows = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.agencyId, AGENCY_ID),
          eq(messagesTable.threadId, params.data.id),
        ),
      )
      .orderBy(messagesTable.createdAt);
    res.json(ListThreadMessagesResponse.parse(rows.map(formatMessage)));
  },
);

router.post(
  "/message-threads/:id/messages",
  async (req, res): Promise<void> => {
    const params = PostThreadMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = PostThreadMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!(await assertFamilyThreadAccess(req, res, params.data.id))) return;
    const [thread] = await db
      .select()
      .from(messageThreadsTable)
      .where(
        and(
          eq(messageThreadsTable.agencyId, AGENCY_ID),
          eq(messageThreadsTable.id, params.data.id),
        ),
      );
    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }
    const authorHeader =
      (req.header("x-family-user-id") as string | undefined) ??
      (req.header("x-user-id") as string | undefined);
    const authorRoleHeader =
      (req.header("x-user-role") as string | undefined) ?? "AGENCY";
    const authorNameHeader =
      (req.header("x-user-name") as string | undefined) ?? "Agency Staff";
    const participants =
      (thread.participants as Array<{
        userId: string;
        role: string;
        name: string;
      }>) ?? [];
    const me =
      participants.find((p) => p.userId === authorHeader) ?? participants[0];
    const id = newId("msg");
    const now = new Date();
    const [row] = await db
      .insert(messagesTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        threadId: thread.id,
        authorId: me?.userId ?? authorHeader ?? "anonymous",
        authorRole: me?.role ?? authorRoleHeader,
        authorName: me?.name ?? authorNameHeader,
        body: parsed.data.body,
        attachments: parsed.data.attachments ?? [],
        readBy: [me?.userId ?? authorHeader ?? "anonymous"],
      })
      .returning();
    await db
      .update(messageThreadsTable)
      .set({ lastMessageAt: now })
      .where(eq(messageThreadsTable.id, thread.id));
    res.status(201).json(formatMessage(row));
  },
);

export default router;
