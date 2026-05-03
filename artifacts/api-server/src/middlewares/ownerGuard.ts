import type { RequestHandler } from "express";

/**
 * Placeholder OWNER guard for admin surfaces (e.g. BullBoard at /admin/jobs).
 *
 * Real auth is not yet wired. Until then, EVERY environment requires an
 * explicit credential — there is no implicit allow-through:
 *
 *   - `Authorization: Bearer ${ADMIN_BEARER_TOKEN}` is honored when the
 *     env var is set (any environment).
 *   - `X-CareOS-Role: OWNER` is honored ONLY in non-production as a
 *     developer convenience.
 *
 * If neither is present, the request is rejected with 401. In production
 * the header is never honored on its own.
 *
 * Replace this once the real auth task lands.
 */
export const ownerGuard: RequestHandler = (req, res, next) => {
  const isProd = process.env["NODE_ENV"] === "production";
  const adminToken = process.env["ADMIN_BEARER_TOKEN"];

  if (adminToken) {
    const auth = req.header("authorization") ?? "";
    if (auth === `Bearer ${adminToken}`) return next();
  }

  if (!isProd && req.header("x-careos-role") === "OWNER") {
    return next();
  }

  res.status(401).json({ error: "owner role required" });
};
