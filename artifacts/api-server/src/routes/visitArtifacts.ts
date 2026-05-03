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
  GetVisitChecklistResponse,
  CompleteVisitChecklistTaskParams,
  CompleteVisitChecklistTaskBody,
  CompleteVisitChecklistTaskResponse,
  SkipVisitChecklistTaskParams,
  SkipVisitChecklistTaskBody,
  SkipVisitChecklistTaskResponse,
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

type ChecklistTask = {
  taskId: string;
  title: string;
  category: string;
  instructions: string | null;
  requiresPhoto: boolean;
  completed: boolean;
  completedAt: string | null;
  photoUrl: string | null;
  skippedReason: string | null;
};

function formatChecklist(
  row: typeof visitChecklistInstancesTable.$inferSelect,
) {
  return {
    id: row.id,
    visitId: row.visitId,
    carePlanId: row.carePlanId,
    carePlanVersion: row.carePlanVersion,
    tasks: (row.tasks as ChecklistTask[]) ?? [],
    completedAt: row.completedAt,
  };
}

async function loadInstance(visitId: string) {
  const [row] = await db
    .select()
    .from(visitChecklistInstancesTable)
    .where(
      and(
        eq(visitChecklistInstancesTable.agencyId, AGENCY_ID),
        eq(visitChecklistInstancesTable.visitId, visitId),
      ),
    );
  return row;
}

async function ensureVisit(id: string) {
  const [v] = await db
    .select()
    .from(visitsTable)
    .where(and(eq(visitsTable.agencyId, AGENCY_ID), eq(visitsTable.id, id)));
  return v;
}

router.get("/visits/:id/checklist", async (req, res): Promise<void> => {
  const params = GetVisitChecklistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const visit = await ensureVisit(params.data.id);
  if (!visit) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }
  const row = await loadInstance(visit.id);
  if (!row) {
    res.status(404).json({ error: "No checklist for this visit" });
    return;
  }
  res.json(GetVisitChecklistResponse.parse(formatChecklist(row)));
});

router.post(
  "/visits/:id/checklist/tasks/:taskId/complete",
  async (req, res): Promise<void> => {
    const params = CompleteVisitChecklistTaskParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CompleteVisitChecklistTaskBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const row = await loadInstance(params.data.id);
    if (!row) {
      res.status(404).json({ error: "Checklist not found" });
      return;
    }
    const tasks = (row.tasks as ChecklistTask[]) ?? [];
    const idx = tasks.findIndex((t) => t.taskId === params.data.taskId);
    if (idx === -1) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const target = tasks[idx];
    const photoUrl = parsed.data.photoUrl ?? target.photoUrl ?? null;
    if (target.requiresPhoto && !photoUrl) {
      res
        .status(400)
        .json({ error: "A photo is required to complete this task" });
      return;
    }
    const updated: ChecklistTask = {
      ...target,
      completed: true,
      completedAt: new Date().toISOString(),
      photoUrl,
      skippedReason: null,
    };
    const newTasks = [...tasks];
    newTasks[idx] = updated;
    const allDone = newTasks.every(
      (t) => t.completed || t.skippedReason !== null,
    );
    const [next] = await db
      .update(visitChecklistInstancesTable)
      .set({
        tasks: newTasks,
        completedAt: allDone ? new Date() : null,
      })
      .where(eq(visitChecklistInstancesTable.id, row.id))
      .returning();
    await recordAudit({
      action: "COMPLETE_VISIT_TASK",
      entityType: "Visit",
      entityId: row.visitId,
      summary: `Task "${target.title}" completed`,
      afterState: updated,
    });
    res.json(CompleteVisitChecklistTaskResponse.parse(formatChecklist(next)));
  },
);

router.post(
  "/visits/:id/checklist/tasks/:taskId/skip",
  async (req, res): Promise<void> => {
    const params = SkipVisitChecklistTaskParams.safeParse(req.params);
    const parsed = SkipVisitChecklistTaskBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : parsed.error!.message,
      });
      return;
    }
    const row = await loadInstance(params.data.id);
    if (!row) {
      res.status(404).json({ error: "Checklist not found" });
      return;
    }
    const tasks = (row.tasks as ChecklistTask[]) ?? [];
    const idx = tasks.findIndex((t) => t.taskId === params.data.taskId);
    if (idx === -1) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const target = tasks[idx];
    const updated: ChecklistTask = {
      ...target,
      completed: false,
      completedAt: null,
      photoUrl: null,
      skippedReason: parsed.data.reason,
    };
    const newTasks = [...tasks];
    newTasks[idx] = updated;
    const allDone = newTasks.every(
      (t) => t.completed || t.skippedReason !== null,
    );
    const [next] = await db
      .update(visitChecklistInstancesTable)
      .set({
        tasks: newTasks,
        completedAt: allDone ? new Date() : null,
      })
      .where(eq(visitChecklistInstancesTable.id, row.id))
      .returning();
    await recordAudit({
      action: "SKIP_VISIT_TASK",
      entityType: "Visit",
      entityId: row.visitId,
      summary: `Task "${target.title}" skipped: ${parsed.data.reason}`,
      afterState: updated,
    });
    res.json(SkipVisitChecklistTaskResponse.parse(formatChecklist(next)));
  },
);

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
