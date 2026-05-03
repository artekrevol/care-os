import { Router, type IRouter } from "express";
import { and, eq, desc, isNull } from "drizzle-orm";
import {
  db,
  visitsTable,
  schedulesTable,
  clientsTable,
  carePlansTable,
  visitChecklistInstancesTable,
  visitNotesTable,
  visitIncidentsTable,
  visitSignaturesTable,
  complianceAlertsTable,
} from "@workspace/db";
import { M } from "@workspace/api-zod";
import { AGENCY_ID } from "../../lib/agency";
import { newId } from "../../lib/ids";
import { recordAudit, SYSTEM_ACTOR } from "../../lib/audit";
import { storage } from "@workspace/services";
import { requireCaregiverSession, type MAuthedRequest } from "./middleware";
import { transcribeAudioBase64 } from "./transcribe";

const router: IRouter = Router();

async function loadVisitDetail(visitId: string) {
  const [v] = await db
    .select()
    .from(visitsTable)
    .where(
      and(eq(visitsTable.agencyId, AGENCY_ID), eq(visitsTable.id, visitId)),
    )
    .limit(1);
  if (!v) return null;
  const [c] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, v.clientId))
    .limit(1);
  let plan = null;
  if (v.carePlanId) {
    const [p] = await db
      .select()
      .from(carePlansTable)
      .where(eq(carePlansTable.id, v.carePlanId))
      .limit(1);
    plan = p ?? null;
  } else {
    const plans = await db
      .select()
      .from(carePlansTable)
      .where(
        and(
          eq(carePlansTable.agencyId, AGENCY_ID),
          eq(carePlansTable.clientId, v.clientId),
          eq(carePlansTable.status, "ACTIVE"),
        ),
      )
      .orderBy(desc(carePlansTable.version))
      .limit(1);
    plan = plans[0] ?? null;
  }
  const [checklist] = await db
    .select()
    .from(visitChecklistInstancesTable)
    .where(eq(visitChecklistInstancesTable.visitId, visitId))
    .limit(1);
  const notes = await db
    .select()
    .from(visitNotesTable)
    .where(eq(visitNotesTable.visitId, visitId))
    .orderBy(desc(visitNotesTable.createdAt));
  const incidents = await db
    .select()
    .from(visitIncidentsTable)
    .where(eq(visitIncidentsTable.visitId, visitId))
    .orderBy(desc(visitIncidentsTable.createdAt));
  const [signature] = await db
    .select()
    .from(visitSignaturesTable)
    .where(eq(visitSignaturesTable.visitId, visitId))
    .limit(1);

  return {
    id: v.id,
    scheduleId: v.scheduleId,
    clockInTime: v.clockInTime?.toISOString() ?? null,
    clockOutTime: v.clockOutTime?.toISOString() ?? null,
    clockInLat: v.clockInLat == null ? null : Number(v.clockInLat),
    clockInLng: v.clockInLng == null ? null : Number(v.clockInLng),
    durationMinutes: v.durationMinutes,
    verificationStatus: v.verificationStatus,
    geoFenceMatch: v.geoFenceMatch,
    hasIncident: v.hasIncident,
    client: c
      ? {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          addressLine1: c.addressLine1 ?? null,
          city: c.city ?? null,
          state: c.state ?? null,
          postalCode: c.postalCode ?? null,
          phone: c.phone ?? null,
          carePreferences: c.carePreferences ?? null,
          allergies: c.allergies ?? null,
          emergencyContactName: c.emergencyContactName ?? null,
          emergencyContactPhone: c.emergencyContactPhone ?? null,
        }
      : null,
    carePlan: plan
      ? {
          id: plan.id,
          version: plan.version,
          title: plan.title,
          tasks: plan.tasks,
          goals: plan.goals,
          riskFactors: plan.riskFactors,
        }
      : null,
    checklist: checklist
      ? {
          id: checklist.id,
          tasks: checklist.tasks,
          completedAt: checklist.completedAt?.toISOString() ?? null,
        }
      : null,
    notes: notes.map((n) => ({
      id: n.id,
      authorRole: n.authorRole,
      body: n.body,
      voiceClipUrl: n.voiceClipUrl,
      createdAt: n.createdAt.toISOString(),
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      severity: i.severity,
      category: i.category,
      description: i.description,
      photoUrls: i.photoUrls,
      createdAt: i.createdAt.toISOString(),
    })),
    signature: signature
      ? {
          id: signature.id,
          signerRole: signature.signerRole,
          signerName: signature.signerName,
          signatureSvg: signature.signatureSvg,
          declined: signature.declined,
          declinedReason: signature.declinedReason,
          capturedAt: signature.capturedAt.toISOString(),
        }
      : null,
  };
}

router.get(
  "/m/visits/active",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const [active] = await db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.agencyId, AGENCY_ID),
          eq(visitsTable.caregiverId, caregiverId),
          isNull(visitsTable.clockOutTime),
        ),
      )
      .orderBy(desc(visitsTable.clockInTime))
      .limit(1);
    if (!active) {
      res.json({});
      return;
    }
    const detail = await loadVisitDetail(active.id);
    res.json({ visit: detail });
  },
);

router.post(
  "/m/visits/clock-in",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MClockInBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const [sch] = await db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.id, parsed.data.scheduleId),
          eq(schedulesTable.agencyId, AGENCY_ID),
          eq(schedulesTable.caregiverId, caregiverId),
        ),
      )
      .limit(1);
    if (!sch) {
      res.status(404).json({ error: "schedule not found" });
      return;
    }
    // If a visit already exists for this schedule, return it
    const [existing] = await db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.agencyId, AGENCY_ID),
          eq(visitsTable.scheduleId, sch.id),
        ),
      )
      .limit(1);
    if (existing) {
      const detail = await loadVisitDetail(existing.id);
      res.json(detail);
      return;
    }
    const plans = await db
      .select()
      .from(carePlansTable)
      .where(
        and(
          eq(carePlansTable.agencyId, AGENCY_ID),
          eq(carePlansTable.clientId, sch.clientId),
          eq(carePlansTable.status, "ACTIVE"),
        ),
      )
      .orderBy(desc(carePlansTable.version))
      .limit(1);
    const plan = plans[0] ?? null;
    const id = newId("vis");
    const [row] = await db
      .insert(visitsTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        scheduleId: sch.id,
        caregiverId,
        clientId: sch.clientId,
        clockInTime: new Date(),
        clockInLat:
          parsed.data.latitude != null ? String(parsed.data.latitude) : null,
        clockInLng:
          parsed.data.longitude != null ? String(parsed.data.longitude) : null,
        clockInMethod: "GPS",
        verificationStatus: "PENDING",
        geoFenceMatch: true,
        carePlanId: plan?.id ?? null,
        carePlanVersion: plan?.version ?? null,
      })
      .returning();
    await db
      .update(schedulesTable)
      .set({ status: "IN_PROGRESS" })
      .where(eq(schedulesTable.id, sch.id));
    // Seed checklist from care plan tasks
    if (plan && Array.isArray(plan.tasks) && plan.tasks.length > 0) {
      const tasks = (plan.tasks as Array<Record<string, unknown>>).map(
        (t, idx) => ({
          id: String((t.id as string | undefined) ?? `t${idx}`),
          label: String(t.title ?? t.label ?? `Task ${idx + 1}`),
          done: false,
          notes: undefined,
          photoUrl: undefined,
        }),
      );
      await db.insert(visitChecklistInstancesTable).values({
        id: newId("chk"),
        agencyId: AGENCY_ID,
        visitId: row.id,
        carePlanId: plan.id,
        carePlanVersion: plan.version,
        tasks,
      });
    }
    await recordAudit(SYSTEM_ACTOR, {
      action: "CLOCK_IN",
      entityType: "Visit",
      entityId: row.id,
      summary: "Clock-in (mobile PWA)",
      afterState: row,
    });
    const detail = await loadVisitDetail(row.id);
    res.status(201).json(detail);
  },
);

router.get(
  "/m/visits/:id",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const detail = await loadVisitDetail(req.params.id as string);
    if (!detail) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const [v] = await db
      .select()
      .from(visitsTable)
      .where(eq(visitsTable.id, req.params.id as string))
      .limit(1);
    if (!v || v.caregiverId !== caregiverId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.json(detail);
  },
);

router.post(
  "/m/visits/:id/clock-out",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MClockOutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const [v] = await db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.id, req.params.id as string),
          eq(visitsTable.agencyId, AGENCY_ID),
        ),
      )
      .limit(1);
    if (!v || v.caregiverId !== caregiverId) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const now = new Date();
    const dur = v.clockInTime
      ? Math.round((now.getTime() - v.clockInTime.getTime()) / 60000)
      : 0;
    const exception = dur > 0 && dur < 30 ? "EXCEPTION" : "PENDING";
    const exceptionReason =
      dur > 0 && dur < 30 ? "Visit shorter than 30 minutes" : null;
    const [row] = await db
      .update(visitsTable)
      .set({
        clockOutTime: now,
        clockOutLat:
          parsed.data.latitude != null ? String(parsed.data.latitude) : null,
        clockOutLng:
          parsed.data.longitude != null ? String(parsed.data.longitude) : null,
        clockOutMethod: "GPS",
        durationMinutes: dur,
        caregiverNotes: parsed.data.caregiverNotes ?? v.caregiverNotes,
        verificationStatus: exception,
        exceptionReason,
      })
      .where(eq(visitsTable.id, v.id))
      .returning();
    if (v.scheduleId) {
      await db
        .update(schedulesTable)
        .set({ status: "COMPLETED" })
        .where(eq(schedulesTable.id, v.scheduleId));
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
    await recordAudit(SYSTEM_ACTOR, {
      action: exception === "EXCEPTION" ? "VISIT_EXCEPTION" : "CLOCK_OUT",
      entityType: "Visit",
      entityId: row.id,
      summary: `Clock-out · ${dur} min${exception === "EXCEPTION" ? " (flagged)" : ""}`,
      afterState: row,
    });
    const detail = await loadVisitDetail(row.id);
    res.json(detail);
  },
);

router.put(
  "/m/visits/:id/checklist",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MSaveChecklistBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const [v] = await db
      .select()
      .from(visitsTable)
      .where(eq(visitsTable.id, req.params.id as string))
      .limit(1);
    if (!v || v.caregiverId !== caregiverId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const [existing] = await db
      .select()
      .from(visitChecklistInstancesTable)
      .where(eq(visitChecklistInstancesTable.visitId, v.id))
      .limit(1);
    if (existing) {
      await db
        .update(visitChecklistInstancesTable)
        .set({
          tasks: parsed.data.tasks,
          completedAt: parsed.data.completed ? new Date() : existing.completedAt,
        })
        .where(eq(visitChecklistInstancesTable.id, existing.id));
    } else {
      await db.insert(visitChecklistInstancesTable).values({
        id: newId("chk"),
        agencyId: AGENCY_ID,
        visitId: v.id,
        carePlanId: v.carePlanId,
        carePlanVersion: v.carePlanVersion,
        tasks: parsed.data.tasks,
        completedAt: parsed.data.completed ? new Date() : null,
      });
    }
    await db
      .update(visitsTable)
      .set({
        tasksCompleted: parsed.data.tasks.filter((t) => t.done).map((t) => t.id),
      })
      .where(eq(visitsTable.id, v.id));
    const detail = await loadVisitDetail(v.id);
    res.json(detail);
  },
);

router.post(
  "/m/visits/:id/notes",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MCreateNoteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const [v] = await db
      .select()
      .from(visitsTable)
      .where(eq(visitsTable.id, req.params.id as string))
      .limit(1);
    if (!v || v.caregiverId !== caregiverId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    let body = parsed.data.body ?? "";
    let voiceClipUrl: string | null = null;
    let transcribedAt: Date | null = null;
    if (parsed.data.voiceClipBase64) {
      const buf = Buffer.from(parsed.data.voiceClipBase64, "base64");
      const ext = (parsed.data.voiceClipMime ?? "audio/webm").split("/")[1] ?? "webm";
      const noteId = newId("vnote");
      const key = storage.buildKey({
        agencyId: AGENCY_ID,
        category: "voice-notes",
        id: noteId,
        filename: `clip.${ext}`,
      });
      try {
        await storage.uploadBytes(key, buf, parsed.data.voiceClipMime);
        voiceClipUrl = storage.getPresignedReadUrl(key, {
          ttlSeconds: 7 * 24 * 60 * 60,
        }).url;
      } catch {
        voiceClipUrl = null;
      }
      if (parsed.data.autoTranscribe) {
        const transcript = await transcribeAudioBase64(
          parsed.data.voiceClipBase64,
          parsed.data.voiceClipMime,
        );
        if (transcript) {
          body = body ? `${body}\n\n[transcript] ${transcript}` : transcript;
          transcribedAt = new Date();
        }
      }
    }
    if (!body) {
      res.status(400).json({ error: "note body or voice required" });
      return;
    }
    await db.insert(visitNotesTable).values({
      id: newId("vnote"),
      agencyId: AGENCY_ID,
      visitId: v.id,
      authorId: caregiverId,
      authorRole: "CAREGIVER",
      body,
      voiceClipUrl,
      transcribedAt,
    });
    const detail = await loadVisitDetail(v.id);
    res.json(detail);
  },
);

router.post(
  "/m/visits/:id/incidents",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MCreateIncidentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const [v] = await db
      .select()
      .from(visitsTable)
      .where(eq(visitsTable.id, req.params.id as string))
      .limit(1);
    if (!v || v.caregiverId !== caregiverId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const incidentId = newId("inc");
    const photoUrls: string[] = [];
    for (const [idx, b64] of (parsed.data.photoBase64s ?? []).entries()) {
      const buf = Buffer.from(b64, "base64");
      const key = storage.buildKey({
        agencyId: AGENCY_ID,
        category: "photos",
        id: incidentId,
        filename: `photo-${idx}.jpg`,
      });
      try {
        await storage.uploadBytes(key, buf, "image/jpeg");
        photoUrls.push(
          storage.getPresignedReadUrl(key, { ttlSeconds: 30 * 24 * 3600 }).url,
        );
      } catch {
        // fallback skip
      }
    }
    await db.insert(visitIncidentsTable).values({
      id: incidentId,
      agencyId: AGENCY_ID,
      visitId: v.id,
      reportedBy: caregiverId,
      severity: parsed.data.severity,
      category: parsed.data.category,
      description: parsed.data.description,
      photoUrls,
    });
    await db
      .update(visitsTable)
      .set({ hasIncident: true })
      .where(eq(visitsTable.id, v.id));
    await db.insert(complianceAlertsTable).values({
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "INCIDENT",
      severity:
        parsed.data.severity === "CRITICAL" || parsed.data.severity === "HIGH"
          ? "HIGH"
          : "MEDIUM",
      entityType: "Visit",
      entityId: v.id,
      title: `Incident: ${parsed.data.category}`,
      message: parsed.data.description,
      status: "OPEN",
    });
    await recordAudit(SYSTEM_ACTOR, {
      action: "VISIT_INCIDENT",
      entityType: "Visit",
      entityId: v.id,
      summary: `Incident reported · ${parsed.data.category} (${parsed.data.severity})`,
    });
    const detail = await loadVisitDetail(v.id);
    res.status(201).json(detail);
  },
);

router.post(
  "/m/visits/:id/signature",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MCreateSignatureBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const [v] = await db
      .select()
      .from(visitsTable)
      .where(eq(visitsTable.id, req.params.id as string))
      .limit(1);
    if (!v || v.caregiverId !== caregiverId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const sigId = newId("sig");
    await db.insert(visitSignaturesTable).values({
      id: sigId,
      agencyId: AGENCY_ID,
      visitId: v.id,
      signerRole: parsed.data.signerRole,
      signerName: parsed.data.signerName,
      signatureSvg: parsed.data.signatureSvg ?? null,
      capturedLat:
        parsed.data.latitude != null ? String(parsed.data.latitude) : null,
      capturedLng:
        parsed.data.longitude != null ? String(parsed.data.longitude) : null,
      declined: parsed.data.declined ?? false,
      declinedReason: parsed.data.declinedReason ?? null,
    });
    await db
      .update(visitsTable)
      .set({ clientSignatureId: sigId })
      .where(eq(visitsTable.id, v.id));
    const detail = await loadVisitDetail(v.id);
    res.json(detail);
  },
);

export default router;
