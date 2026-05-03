import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  visitChecklistInstancesTable,
  visitNotesTable,
  visitIncidentsTable,
  visitSignaturesTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/visits/:id/artifacts", async (req, res): Promise<void> => {
  const visitId = req.params.id;
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
  res.json({
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
  });
});

export default router;
