import type { RequestHandler } from "express";

/**
 * Identity attached to every authenticated request. Audit-log writes,
 * care-plan submit/approve/reject, and any other mutation that needs to
 * record "who did this" should read from `req.user` rather than hardcoding
 * an actor.
 */
export interface RequestUser {
  id: string;
  name: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: RequestUser;
    }
  }
}

const DEFAULT_USER_ID = "user_admin";
const DEFAULT_USER_NAME = "Casey Admin";
const DEFAULT_USER_ROLE = "OWNER";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Identity middleware that attaches `req.user` for every request.
 *
 * Trust model (until real auth — Clerk / Replit Auth — is wired up):
 *
 *   - Non-production: `x-careos-user-id`, `x-careos-user-name`, and
 *     `x-careos-user-role` request headers are honored as a developer
 *     convenience so audit-trail flows can be exercised end-to-end with
 *     different identities. Missing headers fall back to the seeded admin.
 *
 *   - Production:
 *       * Identity headers are IGNORED (client-supplied, forgeable) UNLESS
 *         the request also presents `Authorization: Bearer ${ADMIN_BEARER_TOKEN}`,
 *         which mirrors the existing `ownerGuard` convention for trusted
 *         internal callers (cron drivers, admin tooling).
 *       * For any *mutating* request method (POST/PUT/PATCH/DELETE) that
 *         lacks a trusted identity, the request is rejected with 401
 *         instead of silently attributing the action to a placeholder
 *         admin. This is the fail-closed posture for audit attribution:
 *         we would rather refuse a write than record an untrustworthy
 *         actor on it.
 *       * Read-only requests with no identity continue to receive the
 *         seeded admin as `req.user` (audit isn't written on reads).
 *
 * When real auth lands, this middleware should be replaced with one that
 * derives identity from a verified session/token; downstream code that
 * reads `req.user` will not need to change.
 */
export const userContext: RequestHandler = (req, res, next) => {
  const isProd = process.env["NODE_ENV"] === "production";
  const adminToken = process.env["ADMIN_BEARER_TOKEN"];
  const adminAuthorized =
    !!adminToken &&
    req.header("authorization") === `Bearer ${adminToken}`;

  const headersTrusted = !isProd || adminAuthorized;

  const headerId = headersTrusted
    ? req.header("x-careos-user-id")?.trim()
    : undefined;
  const headerName = headersTrusted
    ? req.header("x-careos-user-name")?.trim()
    : undefined;
  const headerRole = headersTrusted
    ? req.header("x-careos-user-role")?.trim()
    : undefined;

  const hasVerifiedIdentity = !!(headerId && headerId.length > 0);

  // In production, fail closed on mutations that have no verified
  // identity — refuse rather than attribute the audit to user_admin.
  if (
    isProd &&
    !hasVerifiedIdentity &&
    !SAFE_METHODS.has(req.method.toUpperCase())
  ) {
    res.status(401).json({
      error:
        "Authentication required: mutating requests must present a verified user identity",
    });
    return;
  }

  req.user = {
    id: hasVerifiedIdentity ? headerId! : DEFAULT_USER_ID,
    name: headerName && headerName.length > 0 ? headerName : DEFAULT_USER_NAME,
    role: headerRole && headerRole.length > 0 ? headerRole : DEFAULT_USER_ROLE,
  };

  next();
};
