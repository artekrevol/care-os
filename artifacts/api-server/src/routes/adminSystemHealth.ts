import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
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
import {
  db,
  webhookEventsTable,
  notificationDeliveriesTable,
} from "@workspace/db";
import { ownerGuard } from "../middlewares/ownerGuard";
import { AGENCY_ID } from "../lib/agency";
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

/**
 * Recent inbound webhook events (Twilio today; structure is provider-agnostic).
 * Owner-only. Returns the latest 50 rows for the agency, with PII fields
 * already redacted at insert time by webhookLogMiddleware.
 */
router.get(
  "/admin/webhook-events/recent",
  ownerGuard,
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        id: webhookEventsTable.id,
        provider: webhookEventsTable.provider,
        route: webhookEventsTable.route,
        eventType: webhookEventsTable.eventType,
        externalId: webhookEventsTable.externalId,
        signatureValid: webhookEventsTable.signatureValid,
        responseStatus: webhookEventsTable.responseStatus,
        errorMessage: webhookEventsTable.errorMessage,
        receivedAt: webhookEventsTable.receivedAt,
        completedAt: webhookEventsTable.completedAt,
      })
      .from(webhookEventsTable)
      .where(eq(webhookEventsTable.agencyId, AGENCY_ID))
      .orderBy(desc(webhookEventsTable.receivedAt))
      .limit(50);
    res.json({ events: rows });
  },
);

/**
 * Recent outbound notification deliveries that did not land successfully —
 * the FAILED rows are the most operationally interesting (they pair with
 * the NOTIFICATION_DELIVERY_FAILED compliance alerts), but we also
 * surface SKIPPED so owners can see when no channel was even attempted.
 * Owner-only.
 */
router.get(
  "/admin/notification-deliveries/recent-failures",
  ownerGuard,
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        id: notificationDeliveriesTable.id,
        notificationTypeId: notificationDeliveriesTable.notificationTypeId,
        channel: notificationDeliveriesTable.channel,
        provider: notificationDeliveriesTable.provider,
        recipient: notificationDeliveriesTable.recipient,
        status: notificationDeliveriesTable.status,
        attempt: notificationDeliveriesTable.attempt,
        error: notificationDeliveriesTable.error,
        subject: notificationDeliveriesTable.subject,
        createdAt: notificationDeliveriesTable.createdAt,
      })
      .from(notificationDeliveriesTable)
      .where(
        and(
          eq(notificationDeliveriesTable.agencyId, AGENCY_ID),
          ne(notificationDeliveriesTable.status, "SENT"),
        ),
      )
      .orderBy(desc(notificationDeliveriesTable.createdAt))
      .limit(50);
    res.json({ deliveries: rows });
  },
);

export default router;
