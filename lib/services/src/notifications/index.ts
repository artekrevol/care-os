import { and, eq } from "drizzle-orm";
import { Resend } from "resend";
import twilio from "twilio";
import webpush from "web-push";
import {
  db,
  notificationTypesTable,
  notificationPreferencesTable,
  notificationLogTable,
  pushSubscriptionsTable,
  caregiversTable,
  familyUsersTable,
} from "@workspace/db";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";

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
): Promise<ChannelDispatchResult> {
  if (!email)
    return { channel: "EMAIL", status: "SKIPPED", error: "no email on file" };
  const r = getResend();
  if (!r) return { channel: "EMAIL", status: "SKIPPED", error: "not configured" };
  try {
    const result = await r.emails.send({
      from: process.env["RESEND_FROM_EMAIL"] ?? "CareOS <noreply@careos.local>",
      to: email,
      subject: p.subject,
      text: p.body,
    });
    return {
      channel: "EMAIL",
      status: "SENT",
      providerMessageId: result.data?.id,
    };
  } catch (err) {
    return { channel: "EMAIL", status: "FAILED", error: (err as Error).message };
  }
}

async function sendSms(
  phone: string | null,
  p: NotificationPayload,
): Promise<ChannelDispatchResult> {
  if (!phone)
    return { channel: "SMS", status: "SKIPPED", error: "no phone on file" };
  const t = getTwilio();
  if (!t) return { channel: "SMS", status: "SKIPPED", error: "not configured" };
  try {
    const msg = await t.messages.create({
      from: process.env["TWILIO_FROM_NUMBER"]!,
      to: phone,
      body: `${p.subject}\n${p.body}${p.url ? `\n${p.url}` : ""}`,
    });
    return { channel: "SMS", status: "SENT", providerMessageId: msg.sid };
  } catch (err) {
    return { channel: "SMS", status: "FAILED", error: (err as Error).message };
  }
}

async function sendPush(
  subs: webpush.PushSubscription[],
  p: NotificationPayload,
): Promise<ChannelDispatchResult> {
  if (!ensureWebPush())
    return { channel: "PUSH", status: "SKIPPED", error: "not configured" };
  if (subs.length === 0)
    return {
      channel: "PUSH",
      status: "SKIPPED",
      error: "no push subscriptions",
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
  return {
    channel: "PUSH",
    status: anyOk ? "SENT" : "FAILED",
    error: anyOk
      ? undefined
      : (results[0] as PromiseRejectedResult).reason?.toString(),
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
  for (const ch of channels) {
    let r: ChannelDispatchResult;
    if (ch === "EMAIL") r = await sendEmail(recipient.email, input.payload);
    else if (ch === "SMS") r = await sendSms(recipient.phone, input.payload);
    else if (ch === "PUSH") r = await sendPush(recipient.pushSubs, input.payload);
    else r = { channel: "IN_APP", status: "SENT" };
    out.push(r);
    try {
      await logDispatch({
        agencyId,
        userId: input.userId,
        userRole: recipient.userRole,
        typeId: input.type,
        result: r,
        payload: input.payload,
      });
    } catch (err) {
      serviceLogger.error(
        { err: (err as Error).message },
        "notification_log insert failed",
      );
    }
    if (r.status === "FAILED")
      serviceLogger.error({ ...r }, "notification dispatch failed");
  }
  return out;
}

export function getVapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}
