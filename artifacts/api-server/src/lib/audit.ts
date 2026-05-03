import { db, auditLogTable } from "@workspace/db";
import { AGENCY_ID } from "./agency";
import { newId } from "./ids";

interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  beforeState?: unknown;
  afterState?: unknown;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  await db.insert(auditLogTable).values({
    id: newId("aud"),
    agencyId: AGENCY_ID,
    userId: "user_admin",
    userName: "Casey Admin",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    summary: input.summary,
    beforeState: (input.beforeState ?? null) as never,
    afterState: (input.afterState ?? null) as never,
  });
}
