import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  caregiverSessionsTable,
  caregiversTable,
} from "@workspace/db";
import { AGENCY_ID } from "../../lib/agency";
import type { Request, Response, NextFunction } from "express";

export type MAuthedRequest = Request & {
  caregiverId: string;
  sessionId: string;
};

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function requireCaregiverSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.header("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  const tokenHash = hashToken(m[1]);
  const [sess] = await db
    .select()
    .from(caregiverSessionsTable)
    .where(
      and(
        eq(caregiverSessionsTable.tokenHash, tokenHash),
        eq(caregiverSessionsTable.agencyId, AGENCY_ID),
        gt(caregiverSessionsTable.expiresAt, new Date()),
        isNull(caregiverSessionsTable.revokedAt),
      ),
    )
    .limit(1);
  if (!sess) {
    res.status(401).json({ error: "invalid or expired session" });
    return;
  }
  // Refresh lastSeenAt (fire and forget)
  await db
    .update(caregiverSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(caregiverSessionsTable.id, sess.id));
  (req as MAuthedRequest).caregiverId = sess.caregiverId;
  (req as MAuthedRequest).sessionId = sess.id;
  next();
}

export async function loadCaregiver(caregiverId: string) {
  const [cg] = await db
    .select()
    .from(caregiversTable)
    .where(
      and(
        eq(caregiversTable.id, caregiverId),
        eq(caregiversTable.agencyId, AGENCY_ID),
      ),
    )
    .limit(1);
  return cg ?? null;
}
