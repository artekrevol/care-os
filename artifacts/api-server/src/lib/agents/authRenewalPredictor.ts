import { and, eq } from "drizzle-orm";
import {
  db,
  authorizationsTable,
  clientsTable,
  authRenewalPredictionsTable,
} from "@workspace/db";
import { AGENCY_ID } from "../agency";
import { newId } from "../ids";
import { recordAgentRun } from "../agentRun";
import { upsertAlert } from "./createAlert";

const DAY = 86400000;

const PAYER_PROFILE: Record<
  string,
  { typicalTurnaroundDays: number; careManager: string }
> = {
  VA_CCN: { typicalTurnaroundDays: 9, careManager: "Maria Lopez at TriWest" },
  MEDICAID_HCBS: {
    typicalTurnaroundDays: 14,
    careManager: "your county HCBS case worker",
  },
  PRIVATE_PAY: { typicalTurnaroundDays: 3, careManager: "the family contact" },
  LTC_INSURANCE: {
    typicalTurnaroundDays: 21,
    careManager: "the LTC insurance claims line",
  },
  COUNTY_IHSS: {
    typicalTurnaroundDays: 30,
    careManager: "the IHSS social worker",
  },
};

type Likelihood = "HIGH" | "MEDIUM" | "LOW";

export type Prediction = {
  authorizationId: string;
  clientId: string;
  daysUntilExpiration: number;
  hoursUtilization: number;
  likelihood: Likelihood;
  riskOfDenial: number;
  rationale: string;
  recommendedAction: string;
};

export async function predictRenewals(
  now: Date = new Date(),
): Promise<Prediction[]> {
  const [auths, clients] = await Promise.all([
    db
      .select()
      .from(authorizationsTable)
      .where(eq(authorizationsTable.agencyId, AGENCY_ID)),
    db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.agencyId, AGENCY_ID)),
  ]);
  const clientById = new Map(clients.map((c) => [c.id, c]));

  // Historical "renewal pattern": for each (clientId,payer) count past auths
  const histKey = (clId: string, payer: string) => `${clId}::${payer}`;
  const histCount = new Map<string, number>();
  for (const a of auths) {
    const k = histKey(a.clientId, a.payer);
    histCount.set(k, (histCount.get(k) ?? 0) + 1);
  }

  const out: Prediction[] = [];
  for (const a of auths) {
    const expiry = new Date(a.expirationDate + "T00:00:00Z");
    const days = Math.ceil((expiry.getTime() - now.getTime()) / DAY);
    if (days < 0 || days > 30) continue;
    const client = clientById.get(a.clientId);
    if (!client) continue;
    const used = Number(a.hoursUsed);
    const total = Number(a.approvedHoursTotal);
    const util = total > 0 ? used / total : 0;
    const profile =
      PAYER_PROFILE[a.payer] ?? { typicalTurnaroundDays: 14, careManager: "the payer's care manager" };
    const priorAuths = (histCount.get(histKey(a.clientId, a.payer)) ?? 0) - 1;

    // Score
    let score = 0; // higher = more risk
    if (client.status !== "ACTIVE") score += 0.4;
    if (util >= 1) score += 0.35;
    else if (util >= 0.95) score += 0.2;
    if (priorAuths === 0) score += 0.25;
    if (days <= profile.typicalTurnaroundDays) score += 0.25;
    if (days <= 7) score += 0.15;

    const likelihood: Likelihood =
      score >= 0.5 ? "LOW" : score >= 0.25 ? "MEDIUM" : "HIGH";
    const reasons: string[] = [];
    if (client.status !== "ACTIVE")
      reasons.push(`client is currently ${client.status}`);
    if (util >= 1)
      reasons.push("approved hours are already fully consumed");
    else if (util >= 0.95)
      reasons.push(`utilization is ${(util * 100).toFixed(0)}% of approved hours`);
    if (priorAuths === 0)
      reasons.push("this is the first authorization from this payer for this client");
    if (days <= profile.typicalTurnaroundDays)
      reasons.push(
        `typical ${a.payer} turnaround is ${profile.typicalTurnaroundDays} days but only ${days} remain`,
      );
    if (reasons.length === 0) reasons.push("standard renewal trajectory");

    const clientName = `${client.firstName} ${client.lastName}`;
    const recommendedAction =
      likelihood === "LOW"
        ? `Call ${profile.careManager} today — average ${a.payer} renewal turnaround is ${profile.typicalTurnaroundDays} days; you have ${days} left.`
        : likelihood === "MEDIUM"
          ? `Submit renewal paperwork this week and confirm receipt with ${profile.careManager}.`
          : `Standard renewal: queue paperwork before day ${profile.typicalTurnaroundDays} of the window.`;

    out.push({
      authorizationId: a.id,
      clientId: a.clientId,
      daysUntilExpiration: days,
      hoursUtilization: Math.round(util * 1000) / 1000,
      likelihood,
      riskOfDenial: Math.min(1, Math.round(score * 100) / 100),
      rationale: `Renewal risk for ${clientName}'s ${a.payer} authorization (${a.authNumber}): ${reasons.join("; ")}.`,
      recommendedAction,
    });
  }
  return out;
}

export async function runAuthRenewalPredictor(
  triggeredBy = "cron",
): Promise<{ runId: string; predictions: number; alertsCreated: number }> {
  const { value, runId } = await recordAgentRun(
    {
      agentName: "auth_renewal_predictor",
      promptVersion: "rule-1.0",
      model: "rules-only",
      triggeredBy,
      triggerReason: "daily cron",
      inputSummary: "All authorizations expiring in next 30 days",
    },
    async (id) => {
      const preds = await predictRenewals();
      if (preds.length) {
        await db.insert(authRenewalPredictionsTable).values(
          preds.map((p) => ({
            id: newId("arp"),
            agencyId: AGENCY_ID,
            authorizationId: p.authorizationId,
            predictedRenewalDate: new Date(
              Date.now() + p.daysUntilExpiration * DAY,
            ),
            riskOfDenial: String(p.riskOfDenial),
            recommendedAction: p.recommendedAction,
            rationale: p.rationale,
            agentRunId: id,
          })),
        );
      }
      let alertsCreated = 0;
      for (const p of preds.filter((p) => p.likelihood === "LOW")) {
        const created = await upsertAlert({
          alertType: "AUTH_RENEWAL_RISK",
          severity: "HIGH",
          entityType: "Authorization",
          entityId: p.authorizationId,
          title: `Renewal at risk — ${p.daysUntilExpiration} days left`,
          message: p.rationale,
          suggestedAction: p.recommendedAction,
          dedupeKey: `pred:renewal:${p.authorizationId}`,
          agentRunId: id,
        });
        if (created) alertsCreated++;
      }
      return {
        value: { predictions: preds.length, alertsCreated },
        outputSummary: `${preds.length} predictions (${preds.filter((p) => p.likelihood === "LOW").length} LOW), ${alertsCreated} new alerts`,
      };
    },
  );
  return { runId, ...value };
}
