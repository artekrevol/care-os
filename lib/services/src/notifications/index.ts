import { and, eq } from "drizzle-orm";
import { Resend } from "resend";
import twilio from "twilio";
import webpush from "web-push";
import {
  db,
  notificationTypesTable,
  notificationPreferencesTable,
  notificationLogTable,
  notificationDeliveriesTable,
  pushSubscriptionsTable,
  caregiversTable,
  familyUsersTable,
  complianceAlertsTable,
} from "@workspace/db";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";
import { recordSuccess, recordError } from "../health/index";

/**
 * Notification types that require *some* channel to land. When every
 * channel attempted for one of these types comes back FAILED, we open a
 * MEDIUM-severity compliance alert so an operator notices and follows up
 * out-of-band (call/text/email). Add IDs here as the seed defines new
 * critical event types.
 */
export const CRITICAL_NOTIFICATION_TYPES = new Set<string>([
  // Aligned with the IDs seeded in artifacts/api-server/src/lib/seed.ts
  // (seedNotificationTypes). Adding an ID that the seed does not produce
  // is a silent no-op and was the root cause of the original drift.
  "visit.late_clock_in",
  "visit.missed",
  "visit.incident_reported",
  "compliance.auth_expiring",
  "compliance.document_expiring",
  "schedule.changed",
]);

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function truncateRecipient(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.length > 200 ? s.slice(0, 200) : s;
}

async function recordDelivery(args: {
  agencyId: string;
  userId: string | null;
  notificationTypeId: string | null;
  channel: "EMAIL" | "SMS" | "PUSH" | "IN_APP";
  provider: string;
  recipient: string | null;
  attempt?: number;
  status: "SENT" | "FAILED" | "SKIPPED";
  providerMessageId?: string | null;
  error?: string | null;
  subject?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(notificationDeliveriesTable).values({
      id: genId("nd"),
      agencyId: args.agencyId,
      userId: args.userId,
      notificationTypeId: args.notificationTypeId,
      channel: args.channel,
      provider: args.provider,
      recipient: truncateRecipient(args.recipient),
      attempt: args.attempt ?? 1,
      status: args.status,
      providerMessageId: args.providerMessageId ?? null,
      error: args.error ? String(args.error).slice(0, 500) : null,
      subject: args.subject ?? null,
      payload: args.payload ?? {},
    });
  } catch (err) {
    serviceLogger.error(
      { err: (err as Error).message },
      "notification_deliveries insert failed",
    );
  }
}

export type NotificationChannel = "EMAIL" | "SMS" | "PUSH" | "IN_APP";

export type NotificationPayload = {
  subject: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
};

export type ChannelDispatchResult = {
  channel: NotificationChannel;
  status: "SENT" | "SKIPPED" | "FAILED";
  providerMessageId?: string;
  error?: string;
};

let resend: Resend | null = null;
function getResend(): Resend | null {
  if (!isModuleConfigured("notifications.email")) return null;
  if (!resend) resend = new Resend(process.env["RESEND_API_KEY"]!);
  return resend;
}

let twilioClient: ReturnType<typeof twilio> | null = null;
function getTwilio(): ReturnType<typeof twilio> | null {
  if (!isModuleConfigured("notifications.sms")) return null;
  if (!twilioClient) {
    twilioClient = twilio(
      process.env["TWILIO_ACCOUNT_SID"]!,
      process.env["TWILIO_AUTH_TOKEN"]!,
    );
  }
  return twilioClient;
}

/**
 * Validate a Twilio webhook request signature. Returns:
 *   - "valid"      → signature checks out, allow
 *   - "invalid"    → signature header present but does not match, reject
 *   - "unconfigured" → TWILIO_AUTH_TOKEN is not set; caller must decide
 *                     whether to allow (dev) or reject (prod)
 */
export function validateTwilioSignature(args: {
  signatureHeader: string | undefined;
  url: string;
  params: Record<string, string>;
}): "valid" | "invalid" | "unconfigured" {
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!token) return "unconfigured";
  if (!args.signatureHeader) return "invalid";
  const ok = twilio.validateRequest(
    token,
    args.signatureHeader,
    args.url,
    args.params,
  );
  return ok ? "valid" : "invalid";
}

/**
 * Fetch the audio bytes for a Twilio Recording URL using the configured
 * account credentials. Returns null when Twilio is unconfigured (dev) so the
 * caller can fall back to URL-only persistence.
 */
export async function fetchTwilioRecordingBytes(
  recordingUrl: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  // Twilio recordings are served at the same URL with `.mp3` suffix for audio.
  const url = recordingUrl.endsWith(".mp3")
    ? recordingUrl
    : `${recordingUrl}.mp3`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!resp.ok) {
    throw new Error(
      `twilio recording fetch failed: ${resp.status} ${resp.statusText}`,
    );
  }
  const ab = await resp.arrayBuffer();
  return {
    bytes: Buffer.from(ab),
    contentType: resp.headers.get("content-type") ?? "audio/mpeg",
  };
}

let webPushReady = false;
function ensureWebPush(): boolean {
  if (!isModuleConfigured("notifications.push")) return false;
  if (!webPushReady) {
    webpush.setVapidDetails(
      process.env["VAPID_SUBJECT"] ?? "mailto:ops@careos.local",
      process.env["VAPID_PUBLIC_KEY"]!,
      process.env["VAPID_PRIVATE_KEY"]!,
    );
    webPushReady = true;
  }
  return true;
}

type ResolvedRecipient = {
  userId: string;
  userRole: string;
  email: string | null;
  phone: string | null;
  pushSubs: webpush.PushSubscription[];
};

async function resolveRecipient(
  agencyId: string,
  userId: string,
): Promise<ResolvedRecipient | null> {
  // Try caregiver first.
  const cg = await db
    .select({
      id: caregiversTable.id,
      email: caregiversTable.email,
      phone: caregiversTable.phone,
    })
    .from(caregiversTable)
    .where(
      and(
        eq(caregiversTable.agencyId, agencyId),
        eq(caregiversTable.userId, userId),
      ),
    )
    .limit(1);
  let role: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  if (cg[0]) {
    role = "CAREGIVER";
    email = cg[0].email ?? null;
    phone = cg[0].phone ?? null;
  } else {
    const fam = await db
      .select({
        id: familyUsersTable.id,
        email: familyUsersTable.email,
        phone: familyUsersTable.phone,
      })
      .from(familyUsersTable)
      .where(
        and(
          eq(familyUsersTable.agencyId, agencyId),
          eq(familyUsersTable.id, userId),
        ),
      )
      .limit(1);
    if (fam[0]) {
      role = "FAMILY";
      email = fam[0].email ?? null;
      phone = fam[0].phone ?? null;
    }
  }
  if (!role) return null;

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.agencyId, agencyId),
        eq(pushSubscriptionsTable.userId, userId),
      ),
    );
  const pushSubs: webpush.PushSubscription[] = subs.map((s) => ({
    endpoint: s.endpoint,
    keys: { p256dh: s.p256dh, auth: s.auth },
  }));
  return { userId, userRole: role, email, phone, pushSubs };
}

async function resolveChannels(
  agencyId: string,
  userId: string,
  typeId: string,
  override?: NotificationChannel[],
): Promise<NotificationChannel[]> {
  if (override && override.length > 0) return override;
  const pref = await db
    .select()
    .from(notificationPreferencesTable)
    .where(
      and(
        eq(notificationPreferencesTable.agencyId, agencyId),
        eq(notificationPreferencesTable.userId, userId),
        eq(notificationPreferencesTable.notificationTypeId, typeId),
      ),
    )
    .limit(1);
  if (pref[0]) {
    if (!pref[0].enabled) return [];
    return pref[0].channels as NotificationChannel[];
  }
  const t = await db
    .select()
    .from(notificationTypesTable)
    .where(eq(notificationTypesTable.id, typeId))
    .limit(1);
  return (t[0]?.defaultChannels as NotificationChannel[] | undefined) ?? [];
}

async function sendEmail(
  email: string | null,
  p: NotificationPayload,
): Promise<ChannelDispatchResult & { recipient: string | null }> {
  if (!email)
    return {
      channel: "EMAIL",
      status: "SKIPPED",
      error: "no email on file",
      recipient: null,
    };
  const r = getResend();
  if (!r)
    return {
      channel: "EMAIL",
      status: "SKIPPED",
      error: "not configured",
      recipient: email,
    };
  try {
    const result = await r.emails.send({
      from: process.env["RESEND_FROM_EMAIL"] ?? "CareOS <noreply@careos.local>",
      to: email,
      subject: p.subject,
      text: p.body,
    });
    recordSuccess("notifications.email");
    return {
      channel: "EMAIL",
      status: "SENT",
      providerMessageId: result.data?.id,
      recipient: email,
    };
  } catch (err) {
    recordError("notifications.email", err);
    return {
      channel: "EMAIL",
      status: "FAILED",
      error: (err as Error).message,
      recipient: email,
    };
  }
}

/**
 * Send a stand-alone email (no `notification_log` row, no preferences). Used
 * by admin-only flows like the DLQ depth alert. Returns { ok, message }.
 */
export async function sendDirectEmail(args: {
  to: string;
  subject: string;
  text: string;
  agencyId?: string;
  notificationTypeId?: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const agencyId =
    args.agencyId ?? process.env["CAREOS_DEFAULT_AGENCY_ID"] ?? "agency_demo";
  const r = getResend();
  if (!r) {
    await recordDelivery({
      agencyId,
      userId: null,
      notificationTypeId: args.notificationTypeId ?? null,
      channel: "EMAIL",
      provider: "resend",
      recipient: args.to,
      status: "SKIPPED",
      error: "not configured",
      subject: args.subject,
    });
    return { ok: false, message: "not configured" };
  }
  try {
    const result = await r.emails.send({
      from: process.env["RESEND_FROM_EMAIL"] ?? "CareOS <noreply@careos.local>",
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
    recordSuccess("notifications.email");
    await recordDelivery({
      agencyId,
      userId: null,
      notificationTypeId: args.notificationTypeId ?? null,
      channel: "EMAIL",
      provider: "resend",
      recipient: args.to,
      status: "SENT",
      providerMessageId: result.data?.id ?? null,
      subject: args.subject,
    });
    return { ok: true, message: result.data?.id ?? "ok" };
  } catch (err) {
    recordError("notifications.email", err);
    await recordDelivery({
      agencyId,
      userId: null,
      notificationTypeId: args.notificationTypeId ?? null,
      channel: "EMAIL",
      provider: "resend",
      recipient: args.to,
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
      subject: args.subject,
    });
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function sendSms(
  phone: string | null,
  p: NotificationPayload,
): Promise<ChannelDispatchResult & { recipient: string | null }> {
  if (!phone)
    return {
      channel: "SMS",
      status: "SKIPPED",
      error: "no phone on file",
      recipient: null,
    };
  const t = getTwilio();
  if (!t)
    return {
      channel: "SMS",
      status: "SKIPPED",
      error: "not configured",
      recipient: phone,
    };
  try {
    const msg = await t.messages.create({
      from: process.env["TWILIO_FROM_NUMBER"]!,
      to: phone,
      body: `${p.subject}\n${p.body}${p.url ? `\n${p.url}` : ""}`,
    });
    recordSuccess("notifications.sms");
    return {
      channel: "SMS",
      status: "SENT",
      providerMessageId: msg.sid,
      recipient: phone,
    };
  } catch (err) {
    recordError("notifications.sms", err);
    return {
      channel: "SMS",
      status: "FAILED",
      error: (err as Error).message,
      recipient: phone,
    };
  }
}

async function sendPush(
  subs: webpush.PushSubscription[],
  p: NotificationPayload,
): Promise<ChannelDispatchResult & { recipient: string | null }> {
  if (!ensureWebPush())
    return {
      channel: "PUSH",
      status: "SKIPPED",
      error: "not configured",
      recipient: null,
    };
  if (subs.length === 0)
    return {
      channel: "PUSH",
      status: "SKIPPED",
      error: "no push subscriptions",
      recipient: null,
    };
  const body = JSON.stringify({
    title: p.subject,
    body: p.body,
    url: p.url,
    data: p.data,
  });
  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s, body)),
  );
  const anyOk = results.some((r) => r.status === "fulfilled");
  if (anyOk) recordSuccess("notifications.push");
  else
    recordError(
      "notifications.push",
      (results[0] as PromiseRejectedResult).reason ?? new Error("push failed"),
    );
  return {
    channel: "PUSH",
    status: anyOk ? "SENT" : "FAILED",
    error: anyOk
      ? undefined
      : (results[0] as PromiseRejectedResult).reason?.toString(),
    recipient:
      subs[0]?.endpoint?.slice(0, 80) ?? null,
  };
}

async function logDispatch(args: {
  agencyId: string;
  userId: string;
  userRole: string;
  typeId: string;
  result: ChannelDispatchResult;
  payload: NotificationPayload;
}): Promise<void> {
  await db.insert(notificationLogTable).values({
    id: `nlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agencyId: args.agencyId,
    userId: args.userId,
    userRole: args.userRole,
    notificationTypeId: args.typeId,
    channel: args.result.channel,
    status: args.result.status === "SENT" ? "SENT" : args.result.status,
    payload: args.payload as unknown as Record<string, unknown>,
    providerMessageId: args.result.providerMessageId ?? null,
    error: args.result.error ?? null,
    sentAt: args.result.status === "SENT" ? new Date() : null,
  });
}

export type SendNotificationInput = {
  userId: string;
  type: string;
  channels?: NotificationChannel[];
  payload: NotificationPayload;
  /**
   * Multi-tenant scoping. Optional — defaults to the
   * `CAREOS_DEFAULT_AGENCY_ID` env var (single-tenant deploys can leave
   * callers free of tenant plumbing).
   */
  agencyId?: string;
};

/**
 * Defaults to the project's current single-agency runtime ("agency_demo") so
 * the simple `{ userId, type, channels?, payload }` call shape works without
 * tenant plumbing. Multi-tenant deploys can override per-call via
 * `input.agencyId` or globally via `CAREOS_DEFAULT_AGENCY_ID`.
 */
function resolveAgencyId(input: SendNotificationInput): string {
  return (
    input.agencyId ??
    process.env["CAREOS_DEFAULT_AGENCY_ID"] ??
    "agency_demo"
  );
}

/**
 * Resolve the recipient, look up their per-type preferences (or fall back to
 * the type's default channels), fan out across email/SMS/push/in-app, and
 * write a row to `notification_log` for each attempted channel.
 */
export async function sendNotification(
  input: SendNotificationInput,
): Promise<ChannelDispatchResult[]> {
  const agencyId = resolveAgencyId(input);
  const recipient = await resolveRecipient(agencyId, input.userId);
  if (!recipient) {
    serviceLogger.warn(
      { userId: input.userId, type: input.type },
      "sendNotification: recipient not found",
    );
    return [];
  }
  const channels = await resolveChannels(
    agencyId,
    input.userId,
    input.type,
    input.channels,
  );
  if (channels.length === 0) return [];

  const out: ChannelDispatchResult[] = [];
  type WithRecipient = ChannelDispatchResult & { recipient?: string | null };
  for (const ch of channels) {
    let r: WithRecipient;
    let provider: string;
    if (ch === "EMAIL") {
      r = await sendEmail(recipient.email, input.payload);
      provider = "resend";
    } else if (ch === "SMS") {
      r = await sendSms(recipient.phone, input.payload);
      provider = "twilio";
    } else if (ch === "PUSH") {
      r = await sendPush(recipient.pushSubs, input.payload);
      provider = "webpush";
    } else {
      r = { channel: "IN_APP", status: "SENT", recipient: null };
      provider = "inapp";
    }
    out.push({
      channel: r.channel,
      status: r.status,
      providerMessageId: r.providerMessageId,
      error: r.error,
    });
    try {
      await logDispatch({
        agencyId,
        userId: input.userId,
        userRole: recipient.userRole,
        typeId: input.type,
        result: {
          channel: r.channel,
          status: r.status,
          providerMessageId: r.providerMessageId,
          error: r.error,
        },
        payload: input.payload,
      });
    } catch (err) {
      serviceLogger.error(
        { err: (err as Error).message },
        "notification_log insert failed",
      );
    }
    await recordDelivery({
      agencyId,
      userId: input.userId,
      notificationTypeId: input.type,
      channel: r.channel,
      provider,
      recipient: r.recipient ?? null,
      status: r.status,
      providerMessageId: r.providerMessageId ?? null,
      error: r.error ?? null,
      subject: input.payload.subject,
      payload: { url: input.payload.url, data: input.payload.data },
    });
    if (r.status === "FAILED")
      serviceLogger.error({ ...r }, "notification dispatch failed");
  }

  // Critical-channel-failure compliance alert: when EVERY attempted channel
  // failed and the type is in the critical set, raise a MEDIUM alert so an
  // operator follows up out-of-band.
  if (
    CRITICAL_NOTIFICATION_TYPES.has(input.type) &&
    out.length > 0 &&
    out.every((r) => r.status === "FAILED")
  ) {
    try {
      await db
        .insert(complianceAlertsTable)
        .values({
          id: genId("calert"),
          agencyId,
          alertType: "NOTIFICATION_DELIVERY_FAILED",
          severity: "MEDIUM",
          entityType: "User",
          entityId: input.userId,
          title: `Could not reach ${recipient.userRole.toLowerCase()} for ${input.type}`,
          message: `All channels (${out.map((r) => r.channel).join(", ")}) failed for "${input.payload.subject}". Follow up by phone.`,
          suggestedAction: "Call the recipient directly and confirm receipt.",
          dedupeKey: `notif-fail:${input.userId}:${input.type}`,
        })
        .onConflictDoNothing();
    } catch (err) {
      serviceLogger.error(
        { err: (err as Error).message },
        "critical-channel-failure alert insert failed",
      );
    }
  }
  return out;
}

/**
 * Cheap probes for each notification channel. Email: Resend domains list.
 * SMS: Twilio account fetch. Push: VAPID key presence (Web Push has no
 * pingable endpoint, so config-only).
 */
export async function probeEmail(): Promise<{ ok: boolean; message: string }> {
  const r = getResend();
  if (!r) return { ok: false, message: "not configured" };
  try {
    await r.domains.list();
    recordSuccess("notifications.email");
    return { ok: true, message: "ok" };
  } catch (err) {
    recordError("notifications.email", err);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function probeSms(): Promise<{ ok: boolean; message: string }> {
  const t = getTwilio();
  if (!t) return { ok: false, message: "not configured" };
  try {
    const acct = await t.api.accounts(process.env["TWILIO_ACCOUNT_SID"]!).fetch();
    recordSuccess("notifications.sms");
    return { ok: true, message: `ok · ${acct.status}` };
  } catch (err) {
    recordError("notifications.sms", err);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function probePush(): Promise<{ ok: boolean; message: string }> {
  if (!ensureWebPush()) return { ok: false, message: "not configured" };
  recordSuccess("notifications.push");
  return { ok: true, message: "VAPID keys configured" };
}

export function getVapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}
