import { and, eq, sql } from "drizzle-orm";
import { db, complianceAlertsTable } from "@workspace/db";
import { AGENCY_ID } from "../agency";
import { newId } from "../ids";

export type AlertInput = {
  alertType: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  entityType: string;
  entityId: string;
  title: string;
  message: string;
  suggestedAction?: string;
  dedupeKey: string;
  agentRunId?: string;
};

/**
 * Insert a compliance alert if no OPEN/ACKNOWLEDGED alert with the same
 * dedupeKey already exists for this agency. Returns the row id when an
 * insert happened, otherwise null.
 */
export async function upsertAlert(input: AlertInput): Promise<string | null> {
  const existing = await db
    .select({ id: complianceAlertsTable.id })
    .from(complianceAlertsTable)
    .where(
      and(
        eq(complianceAlertsTable.agencyId, AGENCY_ID),
        eq(complianceAlertsTable.dedupeKey, input.dedupeKey),
        sql`${complianceAlertsTable.status} in ('OPEN','ACKNOWLEDGED')`,
      ),
    )
    .limit(1);
  if (existing.length > 0) return null;
  const id = newId("alert");
  await db.insert(complianceAlertsTable).values({
    id,
    agencyId: AGENCY_ID,
    alertType: input.alertType,
    severity: input.severity,
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title,
    message: input.message,
    suggestedAction: input.suggestedAction ?? null,
    status: "OPEN",
    dedupeKey: input.dedupeKey,
    agentRunId: input.agentRunId ?? null,
  });
  return id;
}
