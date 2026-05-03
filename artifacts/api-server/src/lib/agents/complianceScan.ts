import { and, eq, lt, sql } from "drizzle-orm";
import {
  db,
  authorizationsTable,
  caregiverDocumentsTable,
  caregiversTable,
  clientsTable,
  complianceAlertsTable,
} from "@workspace/db";
import { AGENCY_ID } from "../agency";
import { recordAgentRun } from "../agentRun";
import { upsertAlert } from "./createAlert";

const DAY = 86400000;

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  return Math.ceil((d.getTime() - Date.now()) / DAY);
}

const DOC_LABEL: Record<string, string> = {
  BACKGROUND_CHECK: "background check",
  TB_TEST: "TB test",
  CPR: "CPR certification",
  I9: "I-9",
  DIRECT_DEPOSIT: "direct deposit form",
};

/**
 * Daily compliance scan. Re-asserts expiration alerts (idempotent via
 * dedupeKey) and prunes stale OPEN alerts whose underlying condition no
 * longer holds (e.g. document was renewed). Returns counts.
 */
export async function runDailyComplianceScan(
  triggeredBy = "cron",
): Promise<{
  runId: string;
  authAlertsCreated: number;
  docAlertsCreated: number;
  alertsPruned: number;
}> {
  const { value, runId } = await recordAgentRun(
    {
      agentName: "compliance_scan",
      promptVersion: "rule-1.0",
      model: "rules-only",
      triggeredBy,
      triggerReason: "daily cron",
      inputSummary: "All authorizations + caregiver documents",
    },
    async (id) => {
      const [auths, docs, caregivers, clients] = await Promise.all([
        db
          .select()
          .from(authorizationsTable)
          .where(eq(authorizationsTable.agencyId, AGENCY_ID)),
        db
          .select()
          .from(caregiverDocumentsTable)
          .where(eq(caregiverDocumentsTable.agencyId, AGENCY_ID)),
        db
          .select()
          .from(caregiversTable)
          .where(eq(caregiversTable.agencyId, AGENCY_ID)),
        db
          .select()
          .from(clientsTable)
          .where(eq(clientsTable.agencyId, AGENCY_ID)),
      ]);
      const cgName = new Map(
        caregivers.map((c) => [c.id, `${c.firstName} ${c.lastName}`]),
      );
      const clName = new Map(
        clients.map((c) => [c.id, `${c.firstName} ${c.lastName}`]),
      );

      const validDedupeKeys = new Set<string>();
      let authAlertsCreated = 0;
      let docAlertsCreated = 0;

      for (const a of auths) {
        const days = daysUntil(a.expirationDate);
        const cn = clName.get(a.clientId) ?? a.clientId;
        if (days >= 0 && days <= 14) {
          const key = `compliance:auth_expiring:${a.id}`;
          validDedupeKeys.add(key);
          const created = await upsertAlert({
            alertType: "AUTH_EXPIRING",
            severity: days <= 3 ? "CRITICAL" : "HIGH",
            entityType: "Authorization",
            entityId: a.id,
            title: `${a.payer} authorization for ${cn} expires in ${days} day${days === 1 ? "" : "s"}`,
            message: `${a.authNumber} expires ${a.expirationDate}. Renewal must be submitted before then.`,
            suggestedAction: `Submit renewal paperwork to ${a.payer} and confirm receipt with the assigned care manager.`,
            dedupeKey: key,
            agentRunId: id,
          });
          if (created) authAlertsCreated++;
        } else if (days < 0 && days >= -14) {
          const key = `compliance:auth_expired:${a.id}`;
          validDedupeKeys.add(key);
          const created = await upsertAlert({
            alertType: "AUTH_EXPIRED",
            severity: "CRITICAL",
            entityType: "Authorization",
            entityId: a.id,
            title: `Authorization for ${cn} has expired`,
            message: `${a.authNumber} lapsed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago. Visits delivered after expiration may not be billable.`,
            suggestedAction: `Pause new visits against this authorization and escalate the renewal with ${a.payer}.`,
            dedupeKey: key,
            agentRunId: id,
          });
          if (created) authAlertsCreated++;
        }
      }

      for (const d of docs) {
        if (!d.expirationDate) continue;
        const days = daysUntil(d.expirationDate);
        const label = DOC_LABEL[d.documentType] ?? d.documentType;
        const cn = cgName.get(d.caregiverId) ?? d.caregiverId;
        if (days >= 0 && days <= 30) {
          const key = `compliance:doc_expiring:${d.id}`;
          validDedupeKeys.add(key);
          const created = await upsertAlert({
            alertType: "DOC_EXPIRING",
            severity: days <= 7 ? "HIGH" : "MEDIUM",
            entityType: "Caregiver",
            entityId: d.caregiverId,
            title: `${label} expiring for ${cn} (${days} days)`,
            message: `${cn}'s ${label} expires on ${d.expirationDate}.`,
            suggestedAction: `Schedule renewal of ${cn}'s ${label} before ${d.expirationDate} or pause new shifts after that date.`,
            dedupeKey: key,
            agentRunId: id,
          });
          if (created) docAlertsCreated++;
        } else if (days < 0) {
          const key = `compliance:doc_expired:${d.id}`;
          validDedupeKeys.add(key);
          const created = await upsertAlert({
            alertType: "DOC_EXPIRED",
            severity: "HIGH",
            entityType: "Caregiver",
            entityId: d.caregiverId,
            title: `${label} expired for ${cn}`,
            message: `${cn}'s ${label} lapsed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago. Caregiver should not be scheduled until renewed.`,
            suggestedAction: `Block scheduling for ${cn} and request fresh ${label} documentation immediately.`,
            dedupeKey: key,
            agentRunId: id,
          });
          if (created) docAlertsCreated++;
        }
      }

      // Prune stale: any OPEN alert generated by compliance_scan whose
      // dedupe key no longer corresponds to a current condition.
      const stale = await db
        .select()
        .from(complianceAlertsTable)
        .where(
          and(
            eq(complianceAlertsTable.agencyId, AGENCY_ID),
            eq(complianceAlertsTable.status, "OPEN"),
            sql`${complianceAlertsTable.dedupeKey} like 'compliance:%'`,
          ),
        );
      let alertsPruned = 0;
      for (const row of stale) {
        if (!row.dedupeKey) continue;
        if (validDedupeKeys.has(row.dedupeKey)) continue;
        await db
          .update(complianceAlertsTable)
          .set({ status: "RESOLVED" })
          .where(eq(complianceAlertsTable.id, row.id));
        alertsPruned++;
      }

      return {
        value: { authAlertsCreated, docAlertsCreated, alertsPruned },
        outputSummary: `auth+${authAlertsCreated} doc+${docAlertsCreated} pruned-${alertsPruned}`,
      };
    },
  );
  return { runId, ...value };
}

// Avoid unused import lint
void lt;
