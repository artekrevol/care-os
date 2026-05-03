import { queue, notifications } from "@workspace/services";
import { logger } from "./logger";

/**
 * Recurring DLQ depth monitor.
 *
 * Every check cycle (driven by the 5-minute cron in workers.ts) we look at
 * each known queue's failed-job count. If any exceeds DLQ_ALERT_THRESHOLD
 * (default 10), we email each address in OWNER_EMAILS. To avoid alert spam,
 * each (queue) pair is debounced for ALERT_COOLDOWN_MS after a successful
 * send.
 *
 * State is in-memory only. A restart resets the cooldown — that's deliberate;
 * a restart is itself a signal worth re-alerting on.
 */

const DEFAULT_THRESHOLD = 10;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

const lastAlertAt = new Map<string, number>();

const KNOWN_QUEUE_NAMES: queue.QueueName[] = [
  "care-plan.generate",
  "anomaly.scan-visit",
  "anomaly.scan-all",
  "schedule.optimize",
  "schedule.suggest-caregivers",
  "notification.send",
  "ocr.extract-document",
  "ai.intake-referral",
  "auth.predict-renewal",
  "auth.predict-renewals-all",
  "compliance.daily-scan",
  "pay-period.auto-close",
  "drive-time.refresh",
  "visit.reminder-15min",
];

function getOwnerEmails(): string[] {
  const raw = process.env["OWNER_EMAILS"] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function getThreshold(): number {
  const raw = process.env["DLQ_ALERT_THRESHOLD"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_THRESHOLD;
}

export interface DlqCheckResult {
  queue: queue.QueueName;
  failed: number;
  alertedTo: string[];
  cooldownActive: boolean;
}

export async function runDlqCheck(): Promise<DlqCheckResult[]> {
  const threshold = getThreshold();
  const owners = getOwnerEmails();
  const out: DlqCheckResult[] = [];
  const now = Date.now();

  for (const name of KNOWN_QUEUE_NAMES) {
    const q = queue.getQueue(name);
    if (!q) continue;
    let failed = 0;
    try {
      const counts = await q.getJobCounts("failed");
      failed = counts["failed"] ?? 0;
    } catch (err) {
      logger.warn({ err: (err as Error).message, queue: name }, "dlqWatch: getJobCounts failed");
      continue;
    }

    if (failed < threshold) {
      out.push({ queue: name, failed, alertedTo: [], cooldownActive: false });
      continue;
    }

    const last = lastAlertAt.get(name) ?? 0;
    if (now - last < ALERT_COOLDOWN_MS) {
      out.push({ queue: name, failed, alertedTo: [], cooldownActive: true });
      continue;
    }

    if (owners.length === 0) {
      logger.warn(
        { queue: name, failed, threshold },
        "dlqWatch: threshold breached but OWNER_EMAILS unset — skipping email",
      );
      out.push({ queue: name, failed, alertedTo: [], cooldownActive: false });
      continue;
    }

    const subject = `[CareOS] DLQ depth alert: ${name} (${failed} failed)`;
    const text = [
      `Queue "${name}" has ${failed} failed jobs (threshold ${threshold}).`,
      "",
      "Open the system health page or BullBoard to investigate:",
      "  /admin/system-health",
      "  /admin/jobs",
      "",
      "You can bulk-retry or discard failed jobs from the agent-runs admin UI.",
      "",
      "This alert is debounced for 1 hour per queue.",
    ].join("\n");

    const sentTo: string[] = [];
    for (const to of owners) {
      const r = await notifications.sendDirectEmail({ to, subject, text });
      if (r.ok) sentTo.push(to);
      else
        logger.warn(
          { to, queue: name, err: r.message },
          "dlqWatch: send email failed",
        );
    }
    if (sentTo.length > 0) lastAlertAt.set(name, now);
    out.push({
      queue: name,
      failed,
      alertedTo: sentTo,
      cooldownActive: false,
    });
  }

  const alerted = out.filter((r) => r.alertedTo.length > 0);
  if (alerted.length > 0) {
    logger.info(
      { alerts: alerted.map((a) => `${a.queue}:${a.failed}`) },
      "dlqWatch: alerts emitted",
    );
  }
  return out;
}

/** For tests: clear cooldown state. */
export function __resetDlqCooldown(): void {
  lastAlertAt.clear();
}
