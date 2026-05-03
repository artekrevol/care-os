import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { and, eq, desc, gt } from "drizzle-orm";
import {
  db,
  caregiversTable,
  caregiverOtpCodesTable,
  caregiverCredentialsTable,
  caregiverSessionsTable,
} from "@workspace/db";
import { M } from "@workspace/api-zod";
import { AGENCY_ID } from "../../lib/agency";
import { newId } from "../../lib/ids";
import { recordAudit, SYSTEM_ACTOR } from "../../lib/audit";
import { notifications } from "@workspace/services";
import {
  hashToken,
  generateToken,
  requireCaregiverSession,
  loadCaregiver,
  type MAuthedRequest,
} from "./middleware";

const router: IRouter = Router();

const SESSION_TTL_DAYS = 30;

function normalizePhone(p: string): string {
  return p.replace(/[^\d+]/g, "");
}

function hashPin(pin: string, salt: string): string {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${pin}`)
    .digest("hex");
}

async function findCaregiverByPhone(phone: string) {
  const norm = normalizePhone(phone);
  const all = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.agencyId, AGENCY_ID));
  return all.find((c) => c.phone && normalizePhone(c.phone) === norm) ?? null;
}

async function createSession(
  caregiverId: string,
  deviceLabel?: string,
  userAgent?: string,
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = generateToken();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const sessionId = newId("csess");
  await db.insert(caregiverSessionsTable).values({
    id: sessionId,
    agencyId: AGENCY_ID,
    caregiverId,
    tokenHash: hashToken(token),
    deviceLabel: deviceLabel ?? null,
    userAgent: userAgent ?? null,
    expiresAt,
  });
  return { token, expiresAt, sessionId };
}

async function getOrCreateCredentials(caregiverId: string) {
  const [existing] = await db
    .select()
    .from(caregiverCredentialsTable)
    .where(eq(caregiverCredentialsTable.caregiverId, caregiverId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(caregiverCredentialsTable)
    .values({ caregiverId, agencyId: AGENCY_ID, webauthnCredentials: [] })
    .returning();
  return created;
}

router.post("/m/auth/request-otp", async (req, res): Promise<void> => {
  const parsed = M.MRequestOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const cg = await findCaregiverByPhone(parsed.data.phone);
  if (!cg) {
    // Don't leak whether the phone exists.
    res.json({ ok: true, expiresInSeconds: 300 });
    return;
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await db.insert(caregiverOtpCodesTable).values({
    id: newId("otp"),
    agencyId: AGENCY_ID,
    caregiverId: cg.id,
    phone: parsed.data.phone,
    codeHash,
    expiresAt,
  });
  // Try to send via Twilio; fall back to dev devCode in response.
  let sent = false;
  try {
    const r = await notifications.sendNotification({
      userId: cg.userId ?? cg.id,
      type: "caregiver_otp",
      channels: ["SMS"],
      payload: {
        subject: "CareOS code",
        body: `Your CareOS login code is ${code}. It expires in 5 minutes.`,
      },
    });
    sent = r.some((x) => x.status === "SENT");
  } catch {
    sent = false;
  }
  await recordAudit(SYSTEM_ACTOR, {
    action: "CAREGIVER_OTP_REQUEST",
    entityType: "Caregiver",
    entityId: cg.id,
    summary: sent ? "OTP sent via SMS" : "OTP generated (SMS not configured)",
  });
  const body: { ok: boolean; expiresInSeconds: number; devCode?: string } = {
    ok: true,
    expiresInSeconds: 300,
  };
  if (!sent && process.env.NODE_ENV !== "production") {
    body.devCode = code;
  }
  res.json(body);
});

router.post("/m/auth/verify-otp", async (req, res): Promise<void> => {
  const parsed = M.MVerifyOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const cg = await findCaregiverByPhone(parsed.data.phone);
  if (!cg) {
    res.status(401).json({ error: "invalid code" });
    return;
  }
  const codeHash = crypto
    .createHash("sha256")
    .update(parsed.data.code)
    .digest("hex");
  const [otp] = await db
    .select()
    .from(caregiverOtpCodesTable)
    .where(
      and(
        eq(caregiverOtpCodesTable.caregiverId, cg.id),
        eq(caregiverOtpCodesTable.codeHash, codeHash),
        gt(caregiverOtpCodesTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(caregiverOtpCodesTable.createdAt))
    .limit(1);
  if (!otp || otp.consumedAt) {
    res.status(401).json({ error: "invalid or expired code" });
    return;
  }
  await db
    .update(caregiverOtpCodesTable)
    .set({ consumedAt: new Date() })
    .where(eq(caregiverOtpCodesTable.id, otp.id));
  const creds = await getOrCreateCredentials(cg.id);
  const { token, expiresAt } = await createSession(
    cg.id,
    parsed.data.deviceLabel,
    req.header("user-agent") ?? undefined,
  );
  await recordAudit(SYSTEM_ACTOR, {
    action: "CAREGIVER_LOGIN_OTP",
    entityType: "Caregiver",
    entityId: cg.id,
    summary: "Logged in via OTP",
  });
  res.json({
    sessionToken: token,
    expiresAt: expiresAt.toISOString(),
    caregiverId: cg.id,
    hasPin: !!creds.pinHash,
  });
});

router.post(
  "/m/auth/set-pin",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MSetPinBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    await getOrCreateCredentials(caregiverId);
    const salt = crypto.randomBytes(16).toString("hex");
    const pinHash = hashPin(parsed.data.pin, salt);
    await db
      .update(caregiverCredentialsTable)
      .set({
        pinSalt: salt,
        pinHash,
        pinSetAt: new Date(),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      })
      .where(eq(caregiverCredentialsTable.caregiverId, caregiverId));
    const sessions = await db
      .select()
      .from(caregiverSessionsTable)
      .where(eq(caregiverSessionsTable.caregiverId, caregiverId))
      .orderBy(desc(caregiverSessionsTable.createdAt))
      .limit(1);
    await recordAudit(SYSTEM_ACTOR, {
      action: "CAREGIVER_SET_PIN",
      entityType: "Caregiver",
      entityId: caregiverId,
      summary: "Updated login PIN",
    });
    res.json({
      sessionToken: req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "",
      expiresAt: sessions[0]?.expiresAt.toISOString() ?? new Date().toISOString(),
      caregiverId,
    });
  },
);

router.post("/m/auth/login-pin", async (req, res): Promise<void> => {
  const parsed = M.MLoginPinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const cg = await findCaregiverByPhone(parsed.data.phone);
  if (!cg) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  const [creds] = await db
    .select()
    .from(caregiverCredentialsTable)
    .where(eq(caregiverCredentialsTable.caregiverId, cg.id))
    .limit(1);
  if (!creds || !creds.pinHash || !creds.pinSalt) {
    res.status(401).json({ error: "PIN not set" });
    return;
  }
  if (creds.pinLockedUntil && creds.pinLockedUntil > new Date()) {
    res.status(429).json({ error: "Account locked. Try again later." });
    return;
  }
  const candidate = hashPin(parsed.data.pin, creds.pinSalt);
  if (candidate !== creds.pinHash) {
    const attempts = (creds.pinFailedAttempts ?? 0) + 1;
    const locked = attempts >= 5;
    await db
      .update(caregiverCredentialsTable)
      .set({
        pinFailedAttempts: attempts,
        pinLockedUntil: locked
          ? new Date(Date.now() + 15 * 60 * 1000)
          : creds.pinLockedUntil,
      })
      .where(eq(caregiverCredentialsTable.caregiverId, cg.id));
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  await db
    .update(caregiverCredentialsTable)
    .set({ pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(caregiverCredentialsTable.caregiverId, cg.id));
  const { token, expiresAt } = await createSession(
    cg.id,
    parsed.data.deviceLabel,
    req.header("user-agent") ?? undefined,
  );
  await recordAudit(SYSTEM_ACTOR, {
    action: "CAREGIVER_LOGIN_PIN",
    entityType: "Caregiver",
    entityId: cg.id,
    summary: "Logged in via PIN",
  });
  res.json({
    sessionToken: token,
    expiresAt: expiresAt.toISOString(),
    caregiverId: cg.id,
  });
});

router.post(
  "/m/auth/webauthn/register",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MWebauthnRegisterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const creds = await getOrCreateCredentials(caregiverId);
    const list = Array.isArray(creds.webauthnCredentials)
      ? (creds.webauthnCredentials as Array<Record<string, unknown>>)
      : [];
    list.push({
      credentialId: parsed.data.credentialId,
      publicKey: parsed.data.publicKey,
      deviceLabel: parsed.data.deviceLabel ?? null,
      registeredAt: new Date().toISOString(),
    });
    await db
      .update(caregiverCredentialsTable)
      .set({ webauthnCredentials: list })
      .where(eq(caregiverCredentialsTable.caregiverId, caregiverId));
    res.json({ ok: true, count: list.length });
  },
);

router.post("/m/auth/webauthn/login", async (req, res): Promise<void> => {
  const parsed = M.MWebauthnLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const cg = await findCaregiverByPhone(parsed.data.phone);
  if (!cg) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  const [creds] = await db
    .select()
    .from(caregiverCredentialsTable)
    .where(eq(caregiverCredentialsTable.caregiverId, cg.id))
    .limit(1);
  const list = (creds?.webauthnCredentials as
    | Array<{ credentialId: string }>
    | undefined) ?? [];
  const match = list.find((c) => c.credentialId === parsed.data.credentialId);
  if (!match) {
    res.status(401).json({ error: "credential not registered" });
    return;
  }
  // NOTE: For MVP we trust client-side WebAuthn assertion. Full verification
  // would require challenge issuance + signature verification.
  const { token, expiresAt } = await createSession(
    cg.id,
    parsed.data.deviceLabel,
    req.header("user-agent") ?? undefined,
  );
  await recordAudit(SYSTEM_ACTOR, {
    action: "CAREGIVER_LOGIN_WEBAUTHN",
    entityType: "Caregiver",
    entityId: cg.id,
    summary: "Logged in via passkey",
  });
  res.json({
    sessionToken: token,
    expiresAt: expiresAt.toISOString(),
    caregiverId: cg.id,
  });
});

router.post(
  "/m/auth/logout",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const sessionId = (req as MAuthedRequest).sessionId;
    await db
      .update(caregiverSessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(caregiverSessionsTable.id, sessionId));
    res.json({ ok: true });
  },
);

router.get(
  "/m/me",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const cg = await loadCaregiver(caregiverId);
    if (!cg) {
      res.status(404).json({ error: "caregiver not found" });
      return;
    }
    const [creds] = await db
      .select()
      .from(caregiverCredentialsTable)
      .where(eq(caregiverCredentialsTable.caregiverId, caregiverId))
      .limit(1);
    const wa = (creds?.webauthnCredentials as Array<unknown> | undefined) ?? [];
    res.json({
      caregiverId: cg.id,
      firstName: cg.firstName,
      lastName: cg.lastName,
      phone: cg.phone,
      hasPin: !!creds?.pinHash,
      hasWebAuthn: wa.length > 0,
      agencyId: cg.agencyId,
    });
  },
);

export default router;
