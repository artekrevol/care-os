import { Router, type IRouter } from "express";
import { queue } from "@workspace/services";
import {
  RetryAllFailedJobsParams,
  RetryAllFailedJobsQueryParams,
  RetryAllFailedJobsResponse,
  DiscardAllFailedJobsParams,
  DiscardAllFailedJobsQueryParams,
  DiscardAllFailedJobsResponse,
} from "@workspace/api-zod";
import { ownerGuard } from "../middlewares/ownerGuard";
import { recordAudit } from "../lib/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const KNOWN_QUEUE_SET = new Set<queue.QueueName>([
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
]);

function isKnownQueueName(name: string): name is queue.QueueName {
  return KNOWN_QUEUE_SET.has(name as queue.QueueName);
}

router.post(
  "/admin/queues/:name/failed/retry-all",
  ownerGuard,
  async (req, res): Promise<void> => {
    const params = RetryAllFailedJobsParams.safeParse(req.params);
    const query = RetryAllFailedJobsQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    if (!isKnownQueueName(params.data.name)) {
      res.status(404).json({ error: `unknown queue: ${params.data.name}` });
      return;
    }
    const q = queue.getQueue(params.data.name);
    if (!q) {
      res
        .status(503)
        .json({ error: "queue service not configured (UPSTASH_REDIS_URL)" });
      return;
    }
    const limit = query.data.limit;
    const failed = await q.getFailed(0, limit - 1);
    const errors: string[] = [];
    let affected = 0;
    for (const job of failed) {
      try {
        await job.retry();
        affected++;
      } catch (err) {
        errors.push(`${job.id}: ${(err as Error).message}`);
      }
    }
    await recordAudit(req.user, {
      action: "DLQ_RETRY_ALL",
      entityType: "queue",
      entityId: params.data.name,
      summary: `${req.user.name} retried ${affected}/${failed.length} failed jobs on queue ${params.data.name}`,
      afterState: { affected, scanned: failed.length, errorCount: errors.length },
    });
    logger.info(
      { queue: params.data.name, scanned: failed.length, affected },
      "DLQ retry-all",
    );
    res.json(
      RetryAllFailedJobsResponse.parse({
        queue: params.data.name,
        action: "retry",
        scanned: failed.length,
        affected,
        errors,
      }),
    );
  },
);

router.post(
  "/admin/queues/:name/failed/discard-all",
  ownerGuard,
  async (req, res): Promise<void> => {
    const params = DiscardAllFailedJobsParams.safeParse(req.params);
    const query = DiscardAllFailedJobsQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    if (!isKnownQueueName(params.data.name)) {
      res.status(404).json({ error: `unknown queue: ${params.data.name}` });
      return;
    }
    const q = queue.getQueue(params.data.name);
    if (!q) {
      res
        .status(503)
        .json({ error: "queue service not configured (UPSTASH_REDIS_URL)" });
      return;
    }
    const limit = query.data.limit;
    const failed = await q.getFailed(0, limit - 1);
    const errors: string[] = [];
    let affected = 0;
    for (const job of failed) {
      try {
        await job.remove();
        affected++;
      } catch (err) {
        errors.push(`${job.id}: ${(err as Error).message}`);
      }
    }
    await recordAudit(req.user, {
      action: "DLQ_DISCARD_ALL",
      entityType: "queue",
      entityId: params.data.name,
      summary: `${req.user.name} discarded ${affected}/${failed.length} failed jobs on queue ${params.data.name}`,
      afterState: { affected, scanned: failed.length, errorCount: errors.length },
    });
    logger.info(
      { queue: params.data.name, scanned: failed.length, affected },
      "DLQ discard-all",
    );
    res.json(
      DiscardAllFailedJobsResponse.parse({
        queue: params.data.name,
        action: "discard",
        scanned: failed.length,
        affected,
        errors,
      }),
    );
  },
);

export default router;
