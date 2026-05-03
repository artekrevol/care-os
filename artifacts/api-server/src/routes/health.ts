import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { health } from "@workspace/services";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Public, low-cost degradation hint used by UI surfaces to render
 * "service degraded" banners (e.g. AI parser down, push denied, maps
 * quota exceeded). Returns one entry per known module with just enough
 * to drive a UI string — no error details, no probe history. Owner-only
 * details remain at /api/admin/system-health.
 */
router.get("/health/degraded", (_req, res) => {
  const statuses = health.getAllStatuses();
  const degraded = statuses
    .filter(
      (s) =>
        s.configured &&
        (s.errorCount24h > 0 || s.lastProbeOk === false),
    )
    .map((s) => ({
      module: s.module,
      errorCount24h: s.errorCount24h,
      lastProbeOk: s.lastProbeOk,
      lastSuccessAt: s.lastSuccessAt,
    }));
  res.json({ degraded });
});

export default router;
