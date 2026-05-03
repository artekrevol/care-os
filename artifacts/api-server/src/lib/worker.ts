import { and, desc, eq, gte } from "drizzle-orm";
import { db, authorizationsTable, visitsTable } from "@workspace/db";
import { queue, ai } from "@workspace/services";
import { AGENCY_ID } from "./agency";
import { recordAgentRun } from "./agentRun";
import { logger } from "./logger";

const RECURRING_KEY = "careos-recurring";
const AUTH_RENEWAL_INTERVAL_MS = 1000 * 60 * 60 * 6;
const ANOMALY_SCAN_INTERVAL_MS = 1000 * 60 * 30;

let started = false;

export async function startWorkers(): Promise<void> {
  if (started) return;

  const ok = await queue.pingConnection();
  if (!ok) {
    logger.warn(
      "queue service unreachable (check UPSTASH_REDIS_URL credentials) — workers not started",
    );
    return;
  }

  const authQueue = queue.getQueue("auth.predict-renewal");
  const anomalyQueue = queue.getQueue("anomaly.scan-visit");

  if (!authQueue || !anomalyQueue) {
    logger.warn(
      "queue service not configured (UPSTASH_REDIS_URL) — workers not started",
    );
    return;
  }

  queue.registerWorker("auth.predict-renewal", async (job) => {
    return runAuthRenewalPrediction(job.data.authorizationId);
  });

  queue.registerWorker("anomaly.scan-visit", async (job) => {
    return runAnomalyScan(job.data.visitId);
  });

  try {
    await scheduleAuthRenewalCron(authQueue);
    await scheduleAnomalyScanCron(anomalyQueue);
  } catch (err) {
    logger.error({ err }, "failed to schedule recurring jobs");
    return;
  }

  started = true;
  logger.info(
    {
      queues: ["auth.predict-renewal", "anomaly.scan-visit"],
    },
    "workers started with recurring jobs",
  );
}

async function scheduleAuthRenewalCron(q: NonNullable<ReturnType<typeof queue.getQueue>>) {
  const rows = await db
    .select({ id: authorizationsTable.id })
    .from(authorizationsTable)
    .where(eq(authorizationsTable.agencyId, AGENCY_ID))
    .limit(1);
  const seedId = rows[0]?.id ?? "auth_demo_seed";
  await q.add(
    "auth.predict-renewal",
    { authorizationId: seedId },
    {
      repeat: { every: AUTH_RENEWAL_INTERVAL_MS, key: RECURRING_KEY },
      jobId: `${RECURRING_KEY}-auth`,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
}

async function scheduleAnomalyScanCron(q: NonNullable<ReturnType<typeof queue.getQueue>>) {
  const rows = await db
    .select({ id: visitsTable.id })
    .from(visitsTable)
    .where(eq(visitsTable.agencyId, AGENCY_ID))
    .orderBy(desc(visitsTable.createdAt))
    .limit(1);
  const seedId = rows[0]?.id ?? "vis_demo_seed";
  await q.add(
    "anomaly.scan-visit",
    { visitId: seedId },
    {
      repeat: { every: ANOMALY_SCAN_INTERVAL_MS, key: RECURRING_KEY },
      jobId: `${RECURRING_KEY}-anomaly`,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
}

async function runAuthRenewalPrediction(seedAuthId: string) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const auths = await db
    .select({
      id: authorizationsTable.id,
      payer: authorizationsTable.payer,
      hoursAuthorized: authorizationsTable.approvedHoursTotal,
      hoursUsed: authorizationsTable.hoursUsed,
      endDate: authorizationsTable.expirationDate,
    })
    .from(authorizationsTable)
    .where(
      and(
        eq(authorizationsTable.agencyId, AGENCY_ID),
        gte(authorizationsTable.expirationDate, cutoff.toISOString().slice(0, 10)),
      ),
    )
    .limit(20);

  const summary = `Reviewed ${auths.length} active authorization(s) for upcoming renewal risk (seed=${seedAuthId})`;

  const { runId } = await recordAgentRun(
    {
      agentName: "auth-renewal-predictor",
      promptVersion: "v1",
      triggerReason: "recurring",
      inputSummary: summary,
      // Stash original queue payload so a retry from
      // /admin/jobs/agent-runs can re-enqueue the same job.
      metadata: {
        count: auths.length,
        seedAuthId,
        inputPayload: { authorizationId: seedAuthId },
      },
    },
    async () => {
      const prompt = `You are a home-care operations analyst. Given the following authorizations (JSON), identify which are at risk of lapsing in the next 14 days and recommend a renewal action for each. Respond with a short bulleted list.\n\n${JSON.stringify(
        auths,
      ).slice(0, 4000)}`;
      const result = await ai.complete({
        system:
          "You analyze home-care payer authorizations and flag renewal risk concisely.",
        prompt,
        maxTokens: 400,
      });
      return {
        value: { authorizationsReviewed: auths.length },
        outputSummary: result.text.slice(0, 1000),
        outputBytes: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        confidence: 0.7,
      };
    },
  );
  return { runId, authorizationsReviewed: auths.length };
}

async function runAnomalyScan(seedVisitId: string) {
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24);
  const visits = await db
    .select({
      id: visitsTable.id,
      startTime: visitsTable.clockInTime,
      endTime: visitsTable.clockOutTime,
      verificationStatus: visitsTable.verificationStatus,
    })
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, AGENCY_ID),
        gte(visitsTable.createdAt, cutoff),
      ),
    )
    .limit(25);

  const summary = `Scanned ${visits.length} recent visit(s) for anomalies (seed=${seedVisitId})`;
  const { runId } = await recordAgentRun(
    {
      agentName: "anomaly-scan",
      promptVersion: "v1",
      triggerReason: "recurring",
      inputSummary: summary,
      // Stash original queue payload so a retry from
      // /admin/jobs/agent-runs can re-enqueue the same job.
      metadata: {
        count: visits.length,
        seedVisitId,
        inputPayload: { visitId: seedVisitId },
      },
    },
    async () => {
      const prompt = `Identify possible visit anomalies (short duration, missing geofence, late start) in this JSON array. Reply with a short JSON array of {visitId, reason}.\n\n${JSON.stringify(
        visits,
      ).slice(0, 4000)}`;
      const result = await ai.complete({
        system:
          "You are a compliance auditor for home-care visit data. Be concise.",
        prompt,
        maxTokens: 400,
      });
      return {
        value: { visitsScanned: visits.length },
        outputSummary: result.text.slice(0, 1000),
        outputBytes: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        confidence: 0.6,
      };
    },
  );
  return { runId, visitsScanned: visits.length };
}
