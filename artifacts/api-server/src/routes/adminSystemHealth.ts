import { Router, type IRouter } from "express";
import {
  ai,
  ocr,
  realtime,
  storage,
  maps,
  notifications,
  queue,
  health,
} from "@workspace/services";
import {
  GetSystemHealthResponse,
  ProbeSystemHealthModuleParams,
  ProbeSystemHealthModuleResponse,
} from "@workspace/api-zod";
import { ownerGuard } from "../middlewares/ownerGuard";
import { recordAudit } from "../lib/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

type ProbeFn = () => Promise<{ ok: boolean; message: string }>;

const PROBES: Record<string, ProbeFn> = {
  ai: ai.probe,
  ocr: ocr.probe,
  queue: queue.probe,
  realtime: realtime.probe,
  storage: storage.probe,
  maps: maps.probe,
  "notifications.email": notifications.probeEmail,
  "notifications.sms": notifications.probeSms,
  "notifications.push": notifications.probePush,
};

router.get(
  "/admin/system-health",
  ownerGuard,
  async (_req, res): Promise<void> => {
    const modules = health.getAllStatuses();

    const queues: Array<{
      name: string;
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      completed: number;
    }> = [];
    for (const name of KNOWN_QUEUE_NAMES) {
      const q = queue.getQueue(name);
      if (!q) {
        queues.push({
          name,
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 0,
        });
        continue;
      }
      try {
        const counts = await q.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "failed",
          "completed",
        );
        queues.push({
          name,
          waiting: counts["waiting"] ?? 0,
          active: counts["active"] ?? 0,
          delayed: counts["delayed"] ?? 0,
          failed: counts["failed"] ?? 0,
          completed: counts["completed"] ?? 0,
        });
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, queue: name },
          "getJobCounts failed",
        );
        queues.push({
          name,
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 0,
        });
      }
    }

    res.json(GetSystemHealthResponse.parse({ modules, queues }));
  },
);

router.post(
  "/admin/system-health/:module/probe",
  ownerGuard,
  async (req, res): Promise<void> => {
    const params = ProbeSystemHealthModuleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const moduleName = params.data.module;
    const fn = PROBES[moduleName];
    if (!fn) {
      res.status(404).json({ error: `unknown module: ${moduleName}` });
      return;
    }
    const result = await health.runProbe(
      moduleName as health.ModuleName,
      fn,
    );
    await recordAudit(req.user, {
      action: "SYSTEM_HEALTH_PROBE",
      entityType: "system_health",
      entityId: moduleName,
      summary: `${req.user.name} probed ${moduleName} → ${result.ok ? "ok" : "fail"}: ${result.message}`,
    });
    res.json(
      ProbeSystemHealthModuleResponse.parse({
        module: moduleName,
        ok: result.ok,
        message: result.message,
        at: result.at,
      }),
    );
  },
);

export default router;
