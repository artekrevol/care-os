import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, familyUsersTable, messageThreadsTable } from "@workspace/db";
import { AGENCY_ID } from "./agency";

export type FamilyCaller = {
  userId: string;
  clientId: string;
  email: string;
  firstName: string;
  lastName: string;
};

export async function loadFamilyCaller(
  req: Request,
): Promise<FamilyCaller | null> {
  const id = req.header("x-family-user-id");
  if (!id) return null;
  const [row] = await db
    .select()
    .from(familyUsersTable)
    .where(
      and(
        eq(familyUsersTable.agencyId, AGENCY_ID),
        eq(familyUsersTable.id, id),
        eq(familyUsersTable.isActive, true),
      ),
    );
  if (!row) return null;
  return {
    userId: row.id,
    clientId: row.clientId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
  };
}

/**
 * If the request carries an x-family-user-id header, the caller MUST be a
 * known active family user linked to `clientId`. Returns true on pass; on
 * fail it has already written the response (401/403) and callers should
 * stop processing.
 *
 * If no x-family-user-id header is present, the request is treated as a
 * non-family caller and allowed to proceed (existing agency/staff auth is
 * out of scope here).
 */
export async function assertFamilyClientAccess(
  req: Request,
  res: Response,
  clientId: string,
): Promise<boolean> {
  if (!req.header("x-family-user-id")) return true;
  const caller = await loadFamilyCaller(req);
  if (!caller) {
    res.status(401).json({ error: "Unknown family user" });
    return false;
  }
  if (caller.clientId !== clientId) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

export async function assertFamilyThreadAccess(
  req: Request,
  res: Response,
  threadId: string,
): Promise<boolean> {
  if (!req.header("x-family-user-id")) return true;
  const caller = await loadFamilyCaller(req);
  if (!caller) {
    res.status(401).json({ error: "Unknown family user" });
    return false;
  }
  const [thread] = await db
    .select()
    .from(messageThreadsTable)
    .where(
      and(
        eq(messageThreadsTable.agencyId, AGENCY_ID),
        eq(messageThreadsTable.id, threadId),
      ),
    );
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return false;
  }
  const participants =
    (thread.participants as Array<{ userId: string }>) ?? [];
  const ok = participants.some((p) => p.userId === caller.userId);
  if (!ok) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}
