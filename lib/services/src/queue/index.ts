import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";

export type CareOSJobMap = {
  "care-plan.generate": { clientId: string; triggeredBy: string };
  "anomaly.scan-visit": { visitId: string };
  "anomaly.scan-all": { triggeredBy: string };
  "schedule.optimize": { weekStartIso: string };
  "schedule.suggest-caregivers": { agentRunId: string };
  "notification.send": {
    userId: string;
    notificationTypeId: string;
    channels: string[];
    payload: Record<string, unknown>;
  };
  "ocr.extract-document": { documentId: string; objectKey: string };
  "ai.intake-referral": { referralDraftId: string };
  "auth.predict-renewal": { authorizationId: string };
  "auth.predict-renewals-all": { triggeredBy: string };
  "compliance.daily-scan": { triggeredBy: string };
  "pay-period.auto-close": { triggeredBy: string };
  "drive-time.refresh": { originId: string; destId: string };
};

export type QueueName = keyof CareOSJobMap;

let connection: Redis | null = null;
const queues = new Map<QueueName, Queue>();

function getConnection(): Redis | null {
  if (!isModuleConfigured("queue")) return null;
  if (connection) return connection;
  const url = process.env["UPSTASH_REDIS_URL"]!;
  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  connection.on("error", (err) =>
    serviceLogger.error({ err }, "redis connection error"),
  );
  return connection;
}

export function getQueue<N extends QueueName>(name: N): Queue | null {
  const conn = getConnection();
  if (!conn) return null;
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: conn });
    // BullMQ Queue is an EventEmitter; an unhandled 'error' event (e.g. when
    // Redis returns WRONGPASS) crashes the process. Attach a default logger so
    // misconfigured Redis is reported but does not bring the server down.
    q.on("error", (err) =>
      serviceLogger.warn({ err, queue: name }, "queue error (suppressed)"),
    );
    queues.set(name, q);
  }
  return q;
}

export function listQueues(): Queue[] {
  return Array.from(queues.values());
}

export async function enqueue<N extends QueueName>(
  name: N,
  data: CareOSJobMap[N],
  opts?: JobsOptions,
): Promise<{ enqueued: boolean; jobId?: string }> {
  const q = getQueue(name);
  if (!q) {
    serviceLogger.warn(
      { queue: name },
      "queue not configured — job dropped (dev fallback)",
    );
    return { enqueued: false };
  }
  const job = await q.add(name, data, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    ...opts,
  });
  return { enqueued: true, jobId: job.id };
}

export function registerWorker<N extends QueueName>(
  name: N,
  processor: Processor<CareOSJobMap[N]>,
): Worker | null {
  const conn = getConnection();
  if (!conn) {
    serviceLogger.warn(
      { queue: name },
      "queue not configured — worker not started",
    );
    return null;
  }
  const worker = new Worker<CareOSJobMap[N]>(name, processor, {
    connection: conn,
  });
  worker.on("failed", (job, err) =>
    serviceLogger.error({ queue: name, jobId: job?.id, err }, "job failed"),
  );
  worker.on("error", (err) =>
    serviceLogger.warn({ queue: name, err }, "worker error (suppressed)"),
  );
  // Ensure the queue exists so BullBoard can render it.
  getQueue(name);
  return worker;
}

export async function closeAllQueues(): Promise<void> {
  for (const q of queues.values()) await q.close();
  queues.clear();
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
