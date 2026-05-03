import { db, auditLogTable } from "@workspace/db";
import { AGENCY_ID } from "./agency";
import { newId } from "./ids";

export interface AuditActor {
  id: string;
  name: string;
}

interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  beforeState?: unknown;
  afterState?: unknown;
}

/**
 * System actor for non-request-bound writes (background workers, cron,
 * auto-close jobs). Real user-initiated mutations should always pass
 * `req.user` instead.
 */
export const SYSTEM_ACTOR: AuditActor = {
  id: "system",
  name: "System",
};

export async function recordAudit(
  actor: AuditActor,
  input: AuditInput,
): Promise<void> {
  await db.insert(auditLogTable).values({
    id: newId("aud"),
    agencyId: AGENCY_ID,
    userId: actor.id,
    userName: actor.name,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    summary: input.summary,
    beforeState: (input.beforeState ?? null) as never,
    afterState: (input.afterState ?? null) as never,
  });
}
