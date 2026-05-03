import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  visitsTable,
  visitNotesTable,
  visitIncidentsTable,
  visitChecklistInstancesTable,
  visitSignaturesTable,
  complianceAlertsTable,
  familyUsersTable,
} from "@workspace/db";
import {
  GetVisitChecklistParams,
  ListVisitNotesParams,
  ListVisitNotesResponse,
  CreateVisitNoteParams,
  CreateVisitNoteBody,
  ListVisitIncidentsParams,
  ListVisitIncidentsResponse,
  CreateVisitIncidentParams,
  CreateVisitIncidentBody,
  CreateVisitSignatureParams,
  CreateVisitSignatureBody,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { dispatchNotificationToUsers } from "../lib/notify";

const router: IRouter = Router();

router.get("/visits/:id/checklist", async (req, res): Promise<void> => {
  const params = GetVisitChecklistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(visitChecklistInstancesTable)
    .where(
      and(
        eq(visitChecklistInstancesTable.agencyId, AGENCY_ID),
        eq(visitChecklistInstancesTable.visitId, params.data.id),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Checklist not found" });
    return;
  }
  res.json({
    id: row.id,
    visitId: row.visitId,
    carePlanId: row.carePlanId,
    carePlanVersion: row.carePlanVersion,
    tasks: row.tasks ?? [],
    completedAt: row.completedAt,
  });
});

router.get("/visits/:id/notes", async (req, res): Promise<void> => {
  const params = ListVisitNotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(visitNotesTable)
    .where(
      and(
        eq(visitNotesTable.agencyId, AGENCY_ID),
        eq(visitNotesTable.visitId, params.data.id),
      ),
    )
    .orderBy(desc(visitNotesTable.createdAt));
  res.json(
    ListVisitNotesResponse.parse(
      rows.map((n) => ({
        id: n.id,
        visitId: n.visitId,
        authorId: n.authorId,
        authorRole: n.authorRole,
        body: n.body,
        voiceClipUrl: n.voiceClipUrl,
        aiSummary: n.aiSummary,
        createdAt: n.createdAt,
      })),
    ),
  );
});

router.post("/visits/:id/notes", async (req, res): Promise<void> => {
  const params = CreateVisitNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateVisitNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const authorId = (req.header("x-user-id") as string) ?? "user_admin";
  const authorRole = (req.header("x-user-role") as string) ?? "AGENCY";
  const id = newId("note");
  const [row] = await db
    .insert(visitNotesTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      visitId: params.data.id,
      authorId,
      authorRole,
      body: parsed.data.body,
      voiceClipUrl: parsed.data.voiceClipUrl ?? null,
    })
    .returning();
  res.status(201).json({
    id: row.id,
    visitId: row.visitId,
    authorId: row.authorId,
    authorRole: row.authorRole,
    body: row.body,
    voiceClipUrl: row.voiceClipUrl,
    aiSummary: row.aiSummary,
    createdAt: row.createdAt,
  });
});

router.get("/visits/:id/incidents", async (req, res): Promise<void> => {
  const params = ListVisitIncidentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(visitIncidentsTable)
    .where(
      and(
        eq(visitIncidentsTable.agencyId, AGENCY_ID),
        eq(visitIncidentsTable.visitId, params.data.id),
      ),
    )
    .orderBy(desc(visitIncidentsTable.createdAt));
  res.json(
    ListVisitIncidentsResponse.parse(
      rows.map((i) => ({
        id: i.id,
        visitId: i.visitId,
        reportedBy: i.reportedBy,
        severity: i.severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        category: i.category,
        description: i.description,
        photoUrls: i.photoUrls ?? [],
        resolvedAt: i.resolvedAt,
        createdAt: i.createdAt,
      })),
    ),
  );
});

router.post("/visits/:id/incidents", async (req, res): Promise<void> => {
  const params = CreateVisitIncidentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateVisitIncidentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const reportedBy = (req.header("x-user-id") as string) ?? "user_admin";
  const id = newId("inc");
  const [row] = await db
    .insert(visitIncidentsTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      visitId: params.data.id,
      reportedBy,
      severity: parsed.data.severity,
      category: parsed.data.category,
      description: parsed.data.description,
      photoUrls: parsed.data.photoUrls ?? [],
    })
    .returning();
  // Compliance alert + family-visible incident notification trigger point
  await db.insert(complianceAlertsTable).values({
    id: newId("alert"),
    agencyId: AGENCY_ID,
    alertType: "MISSED_VISIT",
    severity:
      parsed.data.severity === "CRITICAL" || parsed.data.severity === "HIGH"
        ? "HIGH"
        : "MEDIUM",
    entityType: "Visit",
    entityId: params.data.id,
    title: `Incident reported: ${parsed.data.category}`,
    message: parsed.data.description.slice(0, 200),
    status: "OPEN",
  });
  await recordAudit({
    action: "CREATE_INCIDENT",
    entityType: "VisitIncident",
    entityId: row.id,
    summary: `Incident logged (${row.severity}) — ${row.category}`,
    afterState: row,
  });
  // Fan out notification to all family users linked to this visit's client
  const [visit] = await db
    .select()
    .from(visitsTable)
    .where(eq(visitsTable.id, params.data.id));
  if (visit) {
    const familyRecipients = await db
      .select()
      .from(familyUsersTable)
      .where(
        and(
          eq(familyUsersTable.agencyId, AGENCY_ID),
          eq(familyUsersTable.clientId, visit.clientId),
          eq(familyUsersTable.isActive, true),
        ),
      );
    await dispatchNotificationToUsers({
      notificationTypeId: "visit.incident_reported",
      recipients: familyRecipients.map((f) => ({
        userId: f.id,
        userRole: "FAMILY",
      })),
      payload: {
        incidentId: row.id,
        visitId: row.visitId,
        clientId: visit.clientId,
        severity: row.severity,
        category: row.category,
      },
    });
  }
  res.status(201).json({
    id: row.id,
    visitId: row.visitId,
    reportedBy: row.reportedBy,
    severity: row.severity,
    category: row.category,
    description: row.description,
    photoUrls: row.photoUrls ?? [],
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  });
});

router.post("/visits/:id/signatures", async (req, res): Promise<void> => {
  const params = CreateVisitSignatureParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateVisitSignatureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = newId("sig");
  const [row] = await db
    .insert(visitSignaturesTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      visitId: params.data.id,
      signerRole: parsed.data.signerRole,
      signerName: parsed.data.signerName,
      signatureSvg: parsed.data.signatureSvg ?? null,
      signatureImageUrl: parsed.data.signatureImageUrl ?? null,
      declined: parsed.data.declined ?? false,
      declinedReason: parsed.data.declinedReason ?? null,
    })
    .returning();
  res.status(201).json({
    id: row.id,
    visitId: row.visitId,
    signerRole: row.signerRole,
    signerName: row.signerName,
    signatureSvg: row.signatureSvg,
    signatureImageUrl: row.signatureImageUrl,
    capturedAt: row.capturedAt,
    declined: row.declined,
    declinedReason: row.declinedReason,
  });
});

export default router;
