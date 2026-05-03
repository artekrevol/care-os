import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
  urlencoded,
} from "express";
import { and, eq, isNull, desc } from "drizzle-orm";
import {
  db,
  caregiversTable,
  schedulesTable,
  visitsTable,
  complianceAlertsTable,
  visitIncidentsTable,
} from "@workspace/db";
import { notifications, storage } from "@workspace/services";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();
const twimlForm = urlencoded({ extended: false });

// ---------------------------------------------------------------------------
// Per-call session state
// ---------------------------------------------------------------------------
//
// Twilio assigns every call a stable `CallSid`. After the caller successfully
// proves possession of a caregiver record (caller-ID match OR caregiver code)
// AND enters the correct PIN, we record a verified session keyed by CallSid.
// Subsequent `gather` steps (menu, incident-done) MUST present the same
// CallSid and matching cgid, otherwise the request is rejected. This prevents
// a caller from skipping straight to /gather?step=menu&cgid=... and
// performing actions for an arbitrary caregiver.
//
// Sessions auto-expire after 10 minutes; expired sessions are pruned lazily.

type Session = { cgid: string; verifiedAt: number };
const SESSIONS = new Map<string, Session>();
const SESSION_TTL_MS = 10 * 60 * 1000;

function setSession(callSid: string, cgid: string): void {
  if (!callSid) return;
  SESSIONS.set(callSid, { cgid, verifiedAt: Date.now() });
}

function getSession(callSid: string): Session | null {
  if (!callSid) return null;
  const s = SESSIONS.get(callSid);
  if (!s) return null;
  if (Date.now() - s.verifiedAt > SESSION_TTL_MS) {
    SESSIONS.delete(callSid);
    return null;
  }
  return s;
}

// PIN-attempt throttling. Track failed attempts per CallSid (max 3) AND per
// caregiver across a 15-minute rolling window (max 5) to make brute force
// across multiple calls infeasible. Successful PIN entry resets both
// counters.
const MAX_CALL_PIN_ATTEMPTS = 3;
const MAX_CAREGIVER_PIN_ATTEMPTS = 5;
const CAREGIVER_LOCKOUT_MS = 15 * 60 * 1000;

const CALL_PIN_ATTEMPTS = new Map<string, number>();
const CAREGIVER_PIN_ATTEMPTS = new Map<string, { count: number; firstAt: number }>();

function recordPinFailure(callSid: string, cgid: string): {
  callExceeded: boolean;
  caregiverLocked: boolean;
} {
  if (callSid) {
    CALL_PIN_ATTEMPTS.set(callSid, (CALL_PIN_ATTEMPTS.get(callSid) ?? 0) + 1);
  }
  const now = Date.now();
  const cur = CAREGIVER_PIN_ATTEMPTS.get(cgid);
  if (!cur || now - cur.firstAt > CAREGIVER_LOCKOUT_MS) {
    CAREGIVER_PIN_ATTEMPTS.set(cgid, { count: 1, firstAt: now });
  } else {
    cur.count += 1;
  }
  const callExceeded =
    (CALL_PIN_ATTEMPTS.get(callSid) ?? 0) >= MAX_CALL_PIN_ATTEMPTS;
  const caregiverLocked =
    (CAREGIVER_PIN_ATTEMPTS.get(cgid)?.count ?? 0) >=
    MAX_CAREGIVER_PIN_ATTEMPTS;
  return { callExceeded, caregiverLocked };
}

function isCaregiverLocked(cgid: string): boolean {
  const cur = CAREGIVER_PIN_ATTEMPTS.get(cgid);
  if (!cur) return false;
  if (Date.now() - cur.firstAt > CAREGIVER_LOCKOUT_MS) {
    CAREGIVER_PIN_ATTEMPTS.delete(cgid);
    return false;
  }
  return cur.count >= MAX_CAREGIVER_PIN_ATTEMPTS;
}

function clearPinAttempts(callSid: string, cgid: string): void {
  CALL_PIN_ATTEMPTS.delete(callSid);
  CAREGIVER_PIN_ATTEMPTS.delete(cgid);
}

// ---------------------------------------------------------------------------
// Twilio signature middleware
// ---------------------------------------------------------------------------

function twilioSignatureGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Build the absolute URL Twilio signed. Honor X-Forwarded-Proto/Host so the
  // signature still matches when the request reaches us through the platform
  // proxy.
  const proto =
    String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() ||
    req.protocol;
  const host = String(req.headers["x-forwarded-host"] ?? req.get("host") ?? "");
  const url = `${proto}://${host}${req.originalUrl}`;
  const signatureHeader =
    (req.headers["x-twilio-signature"] as string | undefined) ?? undefined;
  // Twilio signs the merged form-encoded body. Coerce values to strings.
  const params: Record<string, string> = {};
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(body)) {
    if (v != null) params[k] = String(v);
  }
  const verdict = notifications.validateTwilioSignature({
    signatureHeader,
    url,
    params,
  });
  if (verdict === "valid") {
    next();
    return;
  }
  if (verdict === "invalid") {
    req.log?.warn?.(
      { url, hasSignature: Boolean(signatureHeader) },
      "telephony webhook signature rejected",
    );
    res.status(403).type("text/plain").send("invalid Twilio signature");
    return;
  }
  // Unconfigured: only allow when running outside production so local curl
  // testing keeps working. In production this rejects the request.
  if (process.env["NODE_ENV"] === "production") {
    req.log?.error?.(
      "TWILIO_AUTH_TOKEN not set — rejecting telephony webhook in production",
    );
    res.status(503).type("text/plain").send("telephony not configured");
    return;
  }
  req.log?.warn?.(
    "TWILIO_AUTH_TOKEN not set — skipping signature validation (dev only)",
  );
  next();
}

// ---------------------------------------------------------------------------
// TwiML helpers
// ---------------------------------------------------------------------------

function xml(res: Response, body: string): void {
  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizePhone(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "").replace(/^1/, "");
}

async function findCaregiverByCode(code: string) {
  const [row] = await db
    .select()
    .from(caregiversTable)
    .where(
      and(
        eq(caregiversTable.agencyId, AGENCY_ID),
        eq(caregiversTable.phoneCode, code),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadCaregiver(cgid: string) {
  const [cg] = await db
    .select()
    .from(caregiversTable)
    .where(
      and(eq(caregiversTable.agencyId, AGENCY_ID), eq(caregiversTable.id, cgid)),
    );
  return cg ?? null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Step 1: incoming call. ALWAYS require the 6-digit caregiver ID followed by
// the 4-digit PIN — caller-ID is easy to spoof and cannot be the sole factor.
// Caller-ID is recorded on the audit trail in the clock-in handler so a
// mismatch between the verified caregiver and the originating number is
// visible to supervisors, but it never replaces the credential prompt.
router.post(
  "/telephony/voice",
  twimlForm,
  twilioSignatureGuard,
  async (_req, res): Promise<void> => {
    xml(
      res,
      `<Response>
        <Say voice="Polly.Joanna">Welcome to CareOS. Please enter your six digit caregiver I.D., then press pound.</Say>
        <Gather input="dtmf" numDigits="6" finishOnKey="#" timeout="10" action="/api/telephony/gather?step=code" method="POST" />
        <Say>We did not get your input. Goodbye.</Say>
        <Hangup/>
      </Response>`,
    );
  },
);

// DTMF gather router driven by ?step=
router.post(
  "/telephony/gather",
  twimlForm,
  twilioSignatureGuard,
  async (req, res): Promise<void> => {
    const step = String(req.query?.step ?? "");
    const digits = String(req.body?.Digits ?? "").trim();
    const callSid = String(req.body?.CallSid ?? "");

    // Caregiver-ID code entry (no caller-ID match path)
    if (step === "code") {
      const cg = await findCaregiverByCode(digits);
      if (!cg) {
        xml(
          res,
          `<Response><Say>That caregiver I.D. was not found. Goodbye.</Say><Hangup/></Response>`,
        );
        return;
      }
      xml(
        res,
        `<Response>
          <Say voice="Polly.Joanna">Hello ${escape(cg.firstName)}. Please enter your four digit PIN, then press pound.</Say>
          <Gather input="dtmf" numDigits="4" finishOnKey="#" timeout="8" action="/api/telephony/gather?step=pin&amp;cgid=${encodeURIComponent(cg.id)}" method="POST" />
          <Say>We did not get your input. Goodbye.</Say>
          <Hangup/>
        </Response>`,
      );
      return;
    }

    // PIN verification — on success, mint a verified session for this CallSid
    if (step === "pin") {
      const cgid = String(req.query?.cgid ?? "");
      const cg = await loadCaregiver(cgid);
      if (cg && isCaregiverLocked(cg.id)) {
        req.log?.warn?.(
          { callSid, cgid: cg.id },
          "telephony PIN entry rejected — caregiver temporarily locked",
        );
        xml(
          res,
          `<Response><Say>This account is temporarily locked due to repeated PIN failures. Please try again later or contact your supervisor. Goodbye.</Say><Hangup/></Response>`,
        );
        return;
      }
      if (!cg || cg.phonePin !== digits) {
        const targetId = cg?.id ?? cgid;
        const { callExceeded, caregiverLocked } = recordPinFailure(
          callSid,
          targetId,
        );
        req.log?.warn?.(
          { callSid, cgid: targetId, callExceeded, caregiverLocked },
          "telephony PIN attempt failed",
        );
        if (callExceeded || caregiverLocked) {
          xml(
            res,
            `<Response><Say>Too many incorrect attempts. Goodbye.</Say><Hangup/></Response>`,
          );
          return;
        }
        // Re-prompt so the caller can retry within the same call.
        xml(
          res,
          `<Response>
            <Say>That PIN is incorrect. Please try again.</Say>
            <Gather input="dtmf" numDigits="4" finishOnKey="#" timeout="8" action="/api/telephony/gather?step=pin&amp;cgid=${encodeURIComponent(cgid)}" method="POST" />
            <Say>We did not get your input. Goodbye.</Say>
            <Hangup/>
          </Response>`,
        );
        return;
      }
      clearPinAttempts(callSid, cg.id);
      setSession(callSid, cg.id);
      xml(
        res,
        `<Response>
          <Say voice="Polly.Joanna">You are signed in. Press 1 to clock in. Press 2 to clock out. Press 3 to report an incident.</Say>
          <Gather input="dtmf" numDigits="1" timeout="8" action="/api/telephony/gather?step=menu" method="POST" />
          <Say>We did not get your input. Goodbye.</Say>
          <Hangup/>
        </Response>`,
      );
      return;
    }

    // Authenticated steps: pull cgid from the verified session (NOT a query
    // param) so the caller cannot impersonate another caregiver.
    if (step === "menu" || step === "incident-done") {
      const session = getSession(callSid);
      if (!session) {
        req.log?.warn?.(
          { step, callSid, hasSid: Boolean(callSid) },
          "telephony authenticated step rejected — no verified session",
        );
        xml(
          res,
          `<Response><Say>Your session has expired. Please call again.</Say><Hangup/></Response>`,
        );
        return;
      }
      const cg = await loadCaregiver(session.cgid);
      if (!cg) {
        SESSIONS.delete(callSid);
        xml(res, `<Response><Say>Session ended.</Say><Hangup/></Response>`);
        return;
      }

      if (step === "menu") {
        if (digits === "1") return handleClockIn(req, res, cg);
        if (digits === "2") return handleClockOut(req, res, cg);
        if (digits === "3") return handleIncidentPrompt(res, cg);
        xml(
          res,
          `<Response><Say>Invalid choice. Goodbye.</Say><Hangup/></Response>`,
        );
        return;
      }

      // incident-done
      return handleIncidentDone(req, res, cg);
    }

    xml(res, `<Response><Say>Session ended.</Say><Hangup/></Response>`);
  },
);

// ---------------------------------------------------------------------------
// Menu handlers (extracted for readability; all assume cg is verified)
// ---------------------------------------------------------------------------

async function handleClockIn(
  req: Request,
  res: Response,
  cg: typeof caregiversTable.$inferSelect,
): Promise<void> {
  const today = new Date();
  const candidates = await db
    .select()
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        eq(schedulesTable.caregiverId, cg.id),
      ),
    );
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const sch = candidates
    .filter(
      (s) =>
        s.status !== "COMPLETED" &&
        s.startTime &&
        Math.abs(s.startTime.getTime() - today.getTime()) <= windowMs,
    )
    .sort(
      (a, b) =>
        Math.abs(a.startTime!.getTime() - today.getTime()) -
        Math.abs(b.startTime!.getTime() - today.getTime()),
    )[0];
  if (!sch) {
    xml(
      res,
      `<Response><Say>No scheduled visit was found for the current window. Please contact your supervisor. Goodbye.</Say><Hangup/></Response>`,
    );
    return;
  }
  const id = newId("vis");
  const transcript = `Clock-in via IVR. Caller ID ${normalizePhone(String(req.body?.From ?? ""))}. Schedule ${sch.id}.`;
  const [row] = await db
    .insert(visitsTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      scheduleId: sch.id,
      caregiverId: cg.id,
      clientId: sch.clientId,
      clockInTime: new Date(),
      clockInLat: null,
      clockInLng: null,
      clockInMethod: "TELEPHONY",
      verificationStatus: "PENDING",
      geoFenceMatch: false,
      caregiverNotes: transcript,
    })
    .returning();
  await db
    .update(schedulesTable)
    .set({ status: "IN_PROGRESS" })
    .where(eq(schedulesTable.id, sch.id));
  await recordAudit({
    action: "CLOCK_IN",
    entityType: "Visit",
    entityId: row.id,
    summary: "Clock-in via IVR (TELEPHONY)",
    afterState: row,
  });
  xml(
    res,
    `<Response><Say voice="Polly.Joanna">You are clocked in. Have a great visit. Goodbye.</Say><Hangup/></Response>`,
  );
}

async function handleClockOut(
  _req: Request,
  res: Response,
  cg: typeof caregiversTable.$inferSelect,
): Promise<void> {
  const open = await db
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, AGENCY_ID),
        eq(visitsTable.caregiverId, cg.id),
        isNull(visitsTable.clockOutTime),
      ),
    )
    .orderBy(desc(visitsTable.clockInTime))
    .limit(1);
  const visit = open[0];
  if (!visit) {
    xml(
      res,
      `<Response><Say>You do not have an open visit to clock out of. Goodbye.</Say><Hangup/></Response>`,
    );
    return;
  }
  const now = new Date();
  const dur = visit.clockInTime
    ? Math.round((now.getTime() - visit.clockInTime.getTime()) / 60000)
    : 0;
  const exception = dur > 0 && dur < 30 ? "EXCEPTION" : "PENDING";
  const exceptionReason =
    dur > 0 && dur < 30 ? "Visit shorter than 30 minutes" : null;
  const transcript = `${visit.caregiverNotes ?? ""}\nClock-out via IVR after ${dur} min.`.trim();
  const [row] = await db
    .update(visitsTable)
    .set({
      clockOutTime: now,
      clockOutMethod: "TELEPHONY",
      durationMinutes: dur,
      verificationStatus: exception,
      exceptionReason,
      caregiverNotes: transcript,
      geoFenceMatch: false,
    })
    .where(eq(visitsTable.id, visit.id))
    .returning();
  if (visit.scheduleId) {
    await db
      .update(schedulesTable)
      .set({ status: "COMPLETED" })
      .where(eq(schedulesTable.id, visit.scheduleId));
  }
  if (exception === "EXCEPTION") {
    await db.insert(complianceAlertsTable).values({
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "MISSED_VISIT",
      severity: "HIGH",
      entityType: "Visit",
      entityId: row.id,
      title: "Visit needs review",
      message: exceptionReason ?? "Exception",
      status: "OPEN",
    });
  }
  await recordAudit({
    action: exception === "EXCEPTION" ? "VISIT_EXCEPTION" : "CLOCK_OUT",
    entityType: "Visit",
    entityId: row.id,
    summary: `Clock-out via IVR · ${dur} min${exception === "EXCEPTION" ? " (flagged)" : ""}`,
    afterState: row,
  });
  xml(
    res,
    `<Response><Say voice="Polly.Joanna">You are clocked out. ${dur} minutes recorded. Goodbye.</Say><Hangup/></Response>`,
  );
}

function handleIncidentPrompt(
  res: Response,
  _cg: typeof caregiversTable.$inferSelect,
): void {
  // No cgid in callback URL — the action handler reads it from the verified
  // session keyed by CallSid.
  xml(
    res,
    `<Response>
      <Say voice="Polly.Joanna">After the beep, please describe the incident. Press pound when finished.</Say>
      <Record maxLength="120" finishOnKey="#" playBeep="true" recordingStatusCallback="/api/telephony/recording-complete" action="/api/telephony/gather?step=incident-done" method="POST" />
      <Say>We did not get a recording. Goodbye.</Say>
      <Hangup/>
    </Response>`,
  );
}

async function handleIncidentDone(
  req: Request,
  res: Response,
  cg: typeof caregiversTable.$inferSelect,
): Promise<void> {
  const recordingUrl = String(req.body?.RecordingUrl ?? "");
  const recordingSid = String(req.body?.RecordingSid ?? "");
  const recordingDurationStr = String(req.body?.RecordingDuration ?? "0");
  const recordingDuration = Number(recordingDurationStr) || 0;

  // Find a visit to attach to: prefer the caregiver's currently open visit,
  // fall back to most recent.
  const open = await db
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, AGENCY_ID),
        eq(visitsTable.caregiverId, cg.id),
        isNull(visitsTable.clockOutTime),
      ),
    )
    .orderBy(desc(visitsTable.clockInTime))
    .limit(1);
  let visit = open[0];
  if (!visit) {
    const recent = await db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.agencyId, AGENCY_ID),
          eq(visitsTable.caregiverId, cg.id),
        ),
      )
      .orderBy(desc(visitsTable.clockInTime))
      .limit(1);
    visit = recent[0];
  }

  // Persist the audio. When Twilio + object storage are both configured we
  // download the recording and upload it through the same storage service the
  // PWA uses for incident photos / voice notes, then store the resulting key
  // on visit_incidents.audioUrl. When either is unconfigured (dev / preview)
  // we fall back to the raw RecordingUrl so the data is still recoverable.
  let audioRef: string | null = null;
  let audioKey: string | null = null;
  try {
    const fetched = recordingUrl
      ? await notifications.fetchTwilioRecordingBytes(recordingUrl)
      : null;
    if (fetched) {
      const filename = `${recordingSid || newId("rec")}.mp3`;
      audioKey = storage.buildKey({
        agencyId: AGENCY_ID,
        category: "voice-notes",
        id: visit?.id ?? cg.id,
        filename,
      });
      const uploaded = await storage.uploadBytes(
        audioKey,
        fetched.bytes,
        fetched.contentType,
      );
      if (uploaded) {
        audioRef = storage.buildInternalReadUrl(uploaded.key);
      }
    }
  } catch (err) {
    req.log?.error?.(
      { err: (err as Error).message },
      "telephony incident audio upload failed",
    );
  }
  if (!audioRef && recordingUrl) audioRef = recordingUrl;

  // Create a first-class visit_incidents row when we have a visit to attach
  // it to. This is the same table the in-app incident reporter writes to, so
  // supervisor compliance workflows treat IVR incidents identically.
  let incidentId: string | null = null;
  if (visit) {
    incidentId = newId("inc");
    await db.insert(visitIncidentsTable).values({
      id: incidentId,
      agencyId: AGENCY_ID,
      visitId: visit.id,
      reportedBy: cg.id,
      severity: "MEDIUM",
      category: "VOICE_REPORT",
      description: `Incident reported via IVR (${recordingDuration}s voice recording).`,
      photoUrls: [],
      audioUrl: audioRef,
    });
    const note = `${visit.caregiverNotes ?? ""}\nIncident reported via IVR (incident ${incidentId}).`.trim();
    await db
      .update(visitsTable)
      .set({ hasIncident: true, caregiverNotes: note })
      .where(eq(visitsTable.id, visit.id));
  }

  const alertId = newId("alert");
  await db.insert(complianceAlertsTable).values({
    id: alertId,
    agencyId: AGENCY_ID,
    alertType: "INCIDENT_REPORTED",
    severity: "HIGH",
    entityType: incidentId ? "VisitIncident" : "Caregiver",
    entityId: incidentId ?? cg.id,
    title: "Incident reported via IVR",
    message: `Caregiver phoned in an incident report (${recordingDuration}s).`,
    status: "OPEN",
  });

  await recordAudit({
    action: "INCIDENT_REPORTED",
    entityType: incidentId ? "VisitIncident" : "Caregiver",
    entityId: incidentId ?? cg.id,
    summary: "Incident reported via IVR",
    afterState: {
      incidentId,
      visitId: visit?.id ?? null,
      audioStorageKey: audioKey,
      audioRef,
      recordingSid,
      recordingDuration,
    },
  });

  xml(
    res,
    `<Response><Say voice="Polly.Joanna">Your incident report has been logged and a supervisor will review it. Goodbye.</Say><Hangup/></Response>`,
  );
}

// Twilio recording status callback — fires asynchronously after the call ends.
// Logged for observability; the action handler (incident-done) is what
// actually persists the recording.
router.post(
  "/telephony/recording-complete",
  twimlForm,
  twilioSignatureGuard,
  async (req, res): Promise<void> => {
    req.log?.info?.(
      {
        recordingSid: req.body?.RecordingSid,
        recordingStatus: req.body?.RecordingStatus,
        callSid: req.body?.CallSid,
      },
      "telephony recording status callback",
    );
    res.status(204).end();
  },
);

export default router;
