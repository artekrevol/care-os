import { isModuleConfigured } from "../env";
import { serviceLogger } from "../logger";

/**
 * Lightweight in-memory health tracker for each external service module.
 *
 * Each module records successful invocations and errors here. The admin
 * /system-health endpoint reads this state to render per-service status
 * cards. State is process-local (single-tenant demo posture); a multi-
 * process or multi-tenant deployment would back this with Redis instead.
 */

export type ModuleName =
  | "ai"
  | "ocr"
  | "queue"
  | "realtime"
  | "storage"
  | "notifications.email"
  | "notifications.sms"
  | "notifications.push"
  | "maps";

export const KNOWN_MODULES: ModuleName[] = [
  "ai",
  "ocr",
  "queue",
  "realtime",
  "storage",
  "notifications.email",
  "notifications.sms",
  "notifications.push",
  "maps",
];

type ErrEntry = { at: number; message: string };

interface State {
  lastSuccessAt: number | null;
  errors: ErrEntry[]; // ring buffer, capped MAX_ERRORS, sorted by `at` asc
  lastProbeAt: number | null;
  lastProbeOk: boolean | null;
  lastProbeMessage: string | null;
}

const MAX_ERRORS = 50;
const TWENTY_FOUR_H_MS = 1000 * 60 * 60 * 24;

const states = new Map<ModuleName, State>();

function getOrInit(module: ModuleName): State {
  let s = states.get(module);
  if (!s) {
    s = {
      lastSuccessAt: null,
      errors: [],
      lastProbeAt: null,
      lastProbeOk: null,
      lastProbeMessage: null,
    };
    states.set(module, s);
  }
  return s;
}

export function recordSuccess(module: ModuleName): void {
  const s = getOrInit(module);
  s.lastSuccessAt = Date.now();
}

export function recordError(module: ModuleName, err: unknown): void {
  const s = getOrInit(module);
  const msg = err instanceof Error ? err.message : String(err);
  s.errors.push({ at: Date.now(), message: msg.slice(0, 500) });
  if (s.errors.length > MAX_ERRORS) {
    s.errors.splice(0, s.errors.length - MAX_ERRORS);
  }
}

export interface ModuleStatus {
  module: ModuleName;
  configured: boolean;
  lastSuccessAt: string | null;
  errorCount24h: number;
  recentErrors: Array<{ at: string; message: string }>;
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  lastProbeMessage: string | null;
}

export function getStatus(module: ModuleName): ModuleStatus {
  const s = getOrInit(module);
  const cutoff = Date.now() - TWENTY_FOUR_H_MS;
  const recent = s.errors.filter((e) => e.at >= cutoff);
  return {
    module,
    configured: isModuleConfigured(module),
    lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
    errorCount24h: recent.length,
    recentErrors: recent.slice(-5).map((e) => ({
      at: new Date(e.at).toISOString(),
      message: e.message,
    })),
    lastProbeAt: s.lastProbeAt ? new Date(s.lastProbeAt).toISOString() : null,
    lastProbeOk: s.lastProbeOk,
    lastProbeMessage: s.lastProbeMessage,
  };
}

export function getAllStatuses(): ModuleStatus[] {
  return KNOWN_MODULES.map(getStatus);
}

/**
 * Run a probe and record the result on both the success/error rings and the
 * dedicated lastProbe* fields so the UI can show "tested at X · ok/fail · msg".
 */
export async function runProbe(
  module: ModuleName,
  fn: () => Promise<{ ok: boolean; message: string }>,
): Promise<{ ok: boolean; message: string; at: string }> {
  const s = getOrInit(module);
  const start = Date.now();
  let ok = false;
  let message = "";
  try {
    const r = await fn();
    ok = r.ok;
    message = r.message;
  } catch (err) {
    ok = false;
    message = err instanceof Error ? err.message : String(err);
  }
  s.lastProbeAt = Date.now();
  s.lastProbeOk = ok;
  s.lastProbeMessage = message.slice(0, 500);
  if (ok) {
    s.lastSuccessAt = Date.now();
  } else {
    s.errors.push({ at: Date.now(), message: `probe: ${message}`.slice(0, 500) });
    if (s.errors.length > MAX_ERRORS) {
      s.errors.splice(0, s.errors.length - MAX_ERRORS);
    }
  }
  serviceLogger.info(
    { module, ok, latencyMs: Date.now() - start },
    `probe ${ok ? "ok" : "fail"}`,
  );
  return { ok, message: s.lastProbeMessage!, at: new Date(s.lastProbeAt!).toISOString() };
}
