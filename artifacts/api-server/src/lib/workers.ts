import { queue } from "@workspace/services";
import { logger } from "./logger";
import {
  runAnomalyDetector,
  runAuthRenewalPredictor,
  runDailyComplianceScan,
  autoClosePayPeriods,
  runVisitReminders,
} from "./agents";

let started = false;

const ANOMALY_REPEAT_KEY = "anomaly-hourly";
const PREDICT_REPEAT_KEY = "predict-daily";
const COMPLIANCE_REPEAT_KEY = "compliance-daily";
const PAYPERIOD_REPEAT_KEY = "pay-period-daily";
const VISIT_REMINDER_REPEAT_KEY = "visit-reminder-5min";

function attachErrorHandler(name: string, emitter: { on: (e: string, cb: (err: unknown) => void) => unknown } | null | undefined): void {
  if (!emitter) return;
  emitter.on("error", (err) => {
    logger.warn({ err, name }, "BullMQ emitter error (suppressed)");
  });
}

function safeAddRepeat(
  q: { add: (n: string, d: unknown, o: unknown) => Promise<unknown> } | null,
  jobName: string,
  data: unknown,
  pattern: string,
  key: string,
): void {
  if (!q) return;
  // Fire-and-forget: with a misconfigured Redis the BullMQ promise can hang
  // indefinitely (maxRetriesPerRequest:null). We must not block server boot
  // on cron registration — workers will simply stay idle until Redis is OK.
  Promise.resolve()
    .then(() => q.add(jobName, data, { repeat: { pattern, key }, jobId: key }))
    .catch((err) =>
      logger.warn({ err, jobName }, "Failed to register repeatable cron (continuing)"),
    );
}

export async function startWorkers(): Promise<void> {
  if (started) return;
  started = true;

  const anomalyW = queue.registerWorker("anomaly.scan-all", async (job) => {
    const r = await runAnomalyDetector(job.data.triggeredBy);
    return r;
  });
  const predictW = queue.registerWorker(
    "auth.predict-renewals-all",
    async (job) => {
      const r = await runAuthRenewalPredictor(job.data.triggeredBy);
      return r;
    },
  );
  const complianceW = queue.registerWorker(
    "compliance.daily-scan",
    async (job) => {
      const r = await runDailyComplianceScan(job.data.triggeredBy);
      return r;
    },
  );
  const payPeriodW = queue.registerWorker(
    "pay-period.auto-close",
    async (job) => {
      const r = await autoClosePayPeriods(job.data.triggeredBy);
      return r;
    },
  );
  const reminderW = queue.registerWorker("visit.reminder-15min", async () => {
    return await runVisitReminders();
  });

  // Always attach error handlers so a misconfigured Redis (e.g. WRONGPASS) does
  // not crash the API server via unhandled 'error' events on Queue/Worker.
  attachErrorHandler("anomaly.worker", anomalyW);
  attachErrorHandler("predict.worker", predictW);
  attachErrorHandler("compliance.worker", complianceW);
  attachErrorHandler("payperiod.worker", payPeriodW);
  attachErrorHandler("reminder.worker", reminderW);

  const anomalyQ = queue.getQueue("anomaly.scan-all");
  const predictQ = queue.getQueue("auth.predict-renewals-all");
  const complianceQ = queue.getQueue("compliance.daily-scan");
  const payPeriodQ = queue.getQueue("pay-period.auto-close");
  const reminderQ = queue.getQueue("visit.reminder-15min");
  attachErrorHandler("anomaly.queue", anomalyQ);
  attachErrorHandler("predict.queue", predictQ);
  attachErrorHandler("compliance.queue", complianceQ);
  attachErrorHandler("payperiod.queue", payPeriodQ);
  attachErrorHandler("reminder.queue", reminderQ);

  if (!anomalyW || !predictW || !complianceW || !payPeriodW) {
    logger.warn(
      "Background intelligence workers not started (queue service not configured); cron jobs disabled.",
    );
    return;
  }

  // Wire repeatable cron schedules. Each repeat opts uses a stable key so we
  // don't accumulate duplicates across restarts.
  safeAddRepeat(anomalyQ, "anomaly.scan-all", { triggeredBy: "cron" }, "0 * * * *", ANOMALY_REPEAT_KEY);
  safeAddRepeat(predictQ, "auth.predict-renewals-all", { triggeredBy: "cron" }, "15 6 * * *", PREDICT_REPEAT_KEY);
  safeAddRepeat(complianceQ, "compliance.daily-scan", { triggeredBy: "cron" }, "30 6 * * *", COMPLIANCE_REPEAT_KEY);
  safeAddRepeat(payPeriodQ, "pay-period.auto-close", { triggeredBy: "cron" }, "45 7 * * *", PAYPERIOD_REPEAT_KEY);
  // Every 5 minutes: scan for shifts starting in ~15 minutes and remind the caregiver.
  safeAddRepeat(reminderQ, "visit.reminder-15min", { triggeredBy: "cron" }, "*/5 * * * *", VISIT_REMINDER_REPEAT_KEY);

  logger.info("Background intelligence workers started with cron schedules.");
}

export const AGENT_RUNNERS: Record<
  string,
  (triggeredBy: string) => Promise<unknown>
> = {
  anomaly_detector: (t) => runAnomalyDetector(t),
  auth_renewal_predictor: (t) => runAuthRenewalPredictor(t),
  compliance_scan: (t) => runDailyComplianceScan(t),
  pay_period_auto_close: (t) => autoClosePayPeriods(t),
};
