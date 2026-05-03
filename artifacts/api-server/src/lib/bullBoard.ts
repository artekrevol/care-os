import type { Express } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { queue } from "@workspace/services";
import { ownerGuard } from "../middlewares/ownerGuard";
import { logger } from "./logger";
import { buildAdminJobsRouter } from "./adminJobs";

const KNOWN_QUEUES: queue.QueueName[] = [
  "care-plan.generate",
  "anomaly.scan-visit",
  "anomaly.scan-all",
  "schedule.optimize",
  "notification.send",
  "ocr.extract-document",
  "ai.intake-referral",
  "auth.predict-renewal",
  "auth.predict-renewals-all",
  "compliance.daily-scan",
  "pay-period.auto-close",
  "drive-time.refresh",
];

export function mountBullBoard(app: Express): void {
  // Mount admin sub-routes (token-usage, manual triggers) FIRST so specific
  // paths win over the catch-all bull-board router below.
  app.use("/admin/jobs", buildAdminJobsRouter());

  const adapter = new ExpressAdapter();
  adapter.setBasePath("/admin/jobs");

  const bullQueues = KNOWN_QUEUES.map((name) => queue.getQueue(name)).filter(
    (q): q is NonNullable<typeof q> => q !== null,
  );

  if (bullQueues.length === 0) {
    logger.warn(
      "BullBoard: queue service not configured — /admin/jobs will return 503",
    );
    app.use("/admin/jobs", ownerGuard, (_req, res) => {
      res
        .status(503)
        .json({ error: "queue service not configured (UPSTASH_REDIS_URL)" });
    });
    return;
  }

  createBullBoard({
    queues: bullQueues.map((q) => new BullMQAdapter(q)),
    serverAdapter: adapter,
  });
  app.use("/admin/jobs", ownerGuard, adapter.getRouter());
  logger.info(
    { count: bullQueues.length },
    "BullBoard mounted at /admin/jobs",
  );
}
