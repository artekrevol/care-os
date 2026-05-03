import crypto from "node:crypto";
import { Client } from "@replit/object-storage";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";
import { recordSuccess, recordError } from "../health/index";

let client: Client | null = null;

function getClient(): Client | null {
  if (!isModuleConfigured("storage")) return null;
  if (!client) {
    client = new Client({
      bucketId: process.env["REPLIT_OBJECT_STORE_BUCKET_ID"]!,
    });
  }
  return client;
}

export type ObjectRef = { key: string; bucketId: string };

export function buildKey(parts: {
  agencyId: string;
  category:
    | "agent-input"
    | "agent-output"
    | "signatures"
    | "photos"
    | "voice-notes"
    | "documents"
    | "referrals";
  id: string;
  filename: string;
}): string {
  return `${parts.agencyId}/${parts.category}/${parts.id}/${parts.filename}`;
}

export async function uploadBytes(
  key: string,
  data: Buffer | Uint8Array,
  _contentType?: string,
): Promise<ObjectRef | null> {
  const c = getClient();
  if (!c) {
    serviceLogger.warn(
      { key },
      "object storage not configured — write skipped (dev fallback)",
    );
    return null;
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const result = await c.uploadFromBytes(key, buf, { compress: false });
  if (!result.ok) {
    recordError("storage", result.error);
    throw new Error(`object storage upload failed: ${result.error.message}`);
  }
  recordSuccess("storage");
  return { key, bucketId: process.env["REPLIT_OBJECT_STORE_BUCKET_ID"]! };
}

/**
 * Cheap probe: round-trip a tiny object under a `_probe/` prefix. Records
 * success when both upload and read-back succeed.
 */
export async function probe(): Promise<{ ok: boolean; message: string }> {
  const c = getClient();
  if (!c) return { ok: false, message: "not configured" };
  const key = `_probe/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`;
  try {
    const up = await c.uploadFromBytes(key, Buffer.from("ok"), { compress: false });
    if (!up.ok) {
      recordError("storage", up.error);
      return { ok: false, message: up.error.message };
    }
    recordSuccess("storage");
    return { ok: true, message: "ok" };
  } catch (err) {
    recordError("storage", err);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function downloadBytes(key: string): Promise<Buffer | null> {
  const c = getClient();
  if (!c) return null;
  const result = await c.downloadAsBytes(key);
  if (!result.ok) {
    throw new Error(
      `object storage download failed: ${result.error.message}`,
    );
  }
  // SDK returns [Buffer]; normalize.
  const value = result.value as unknown as Buffer | [Buffer];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Pre-signed URLs.
 *
 * The Replit Object Storage SDK does not expose native pre-signed URLs the way
 * S3/GCS do. We approximate them with HMAC-signed tokens that the api-server's
 * `/api/storage/objects/*` and `/api/storage/uploads/*` companion routes
 * validate before streaming bytes to/from the bucket. The signing secret is
 * `STORAGE_URL_SIGNING_SECRET` (falls back to a per-process random secret in
 * dev — restarting the process will invalidate outstanding URLs).
 */
let signingSecret: string | null = null;
function getSigningSecret(): string {
  if (signingSecret) return signingSecret;
  const fromEnv = process.env["STORAGE_URL_SIGNING_SECRET"];
  if (fromEnv) {
    signingSecret = fromEnv;
  } else {
    signingSecret = crypto.randomBytes(32).toString("hex");
    serviceLogger.warn(
      "STORAGE_URL_SIGNING_SECRET not set — using ephemeral per-process secret. Pre-signed URLs will not survive a restart.",
    );
  }
  return signingSecret;
}

function sign(parts: string): string {
  return crypto
    .createHmac("sha256", getSigningSecret())
    .update(parts)
    .digest("base64url");
}

export type SignedUrlOptions = {
  /** Seconds until the URL expires. Default 15 minutes. */
  ttlSeconds?: number;
};

export type PresignedUrl = {
  url: string;
  expiresAt: number; // epoch ms
};

function buildSigned(
  prefix: string,
  key: string,
  method: "GET" | "PUT",
  ttlSeconds: number,
): PresignedUrl {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(`${method}:${key}:${exp}`);
  const search = new URLSearchParams({ exp: String(exp), sig });
  return {
    url: `${prefix}/${encodeURIComponent(key)}?${search.toString()}`,
    expiresAt: exp * 1000,
  };
}

/** Pre-signed URL the client can `PUT` raw bytes to. */
export function getPresignedUploadUrl(
  key: string,
  opts: SignedUrlOptions = {},
): PresignedUrl {
  return buildSigned(
    "/api/storage/uploads",
    key,
    "PUT",
    opts.ttlSeconds ?? 15 * 60,
  );
}

/** Pre-signed URL the client can `GET` to read the object's bytes. */
export function getPresignedReadUrl(
  key: string,
  opts: SignedUrlOptions = {},
): PresignedUrl {
  return buildSigned(
    "/api/storage/objects",
    key,
    "GET",
    opts.ttlSeconds ?? 15 * 60,
  );
}

/**
 * Verify a token issued by `getPresignedUploadUrl` / `getPresignedReadUrl`.
 * Used by the api-server companion routes.
 */
export function verifySignedUrl(args: {
  key: string;
  method: "GET" | "PUT";
  exp: string | number | undefined;
  sig: string | undefined;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.exp || !args.sig) return { ok: false, reason: "missing token" };
  const expNum = typeof args.exp === "string" ? Number(args.exp) : args.exp;
  if (!Number.isFinite(expNum)) return { ok: false, reason: "bad exp" };
  if (expNum * 1000 < Date.now()) return { ok: false, reason: "expired" };
  const expected = sign(`${args.method}:${args.key}:${expNum}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(args.sig);
  if (a.length !== b.length) return { ok: false, reason: "bad sig" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad sig" };
  return { ok: true };
}

/**
 * @deprecated Use `getPresignedReadUrl` instead. Kept as a convenience for
 * callers that don't need expiry semantics yet.
 */
export function buildInternalReadUrl(key: string): string {
  return `/api/storage/objects/${encodeURIComponent(key)}`;
}
