import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, caregiverDocumentsTable } from "@workspace/db";
import { storage } from "@workspace/services";
import { AGENCY_ID } from "../../lib/agency";
import { newId } from "../../lib/ids";
import { recordAudit } from "../../lib/audit";
import { dispatch } from "../../lib/dispatch";
import { processDocumentClassify } from "../../workers/documentClassifier";
import { requireCaregiverSession, type MAuthedRequest } from "./middleware";

const router: IRouter = Router();

const MUploadDocBody = z.object({
  filename: z.string().optional(),
  contentBase64: z.string().min(1),
  contentType: z.string().optional(),
  documentType: z.string().optional(),
  issuedDate: z.string().optional(),
  expirationDate: z.string().optional(),
});

router.get(
  "/m/documents",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const docs = await db
      .select()
      .from(caregiverDocumentsTable)
      .where(
        and(
          eq(caregiverDocumentsTable.agencyId, AGENCY_ID),
          eq(caregiverDocumentsTable.caregiverId, caregiverId),
        ),
      );
    res.json({
      documents: docs.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        classifiedType: d.classifiedType,
        classificationStatus: d.classificationStatus,
        classificationConfidence:
          d.classificationConfidence == null
            ? null
            : Number(d.classificationConfidence),
        issuedDate: d.issuedDate,
        expirationDate: d.expirationDate,
        fileUrl: d.fileUrl,
        originalFilename: d.originalFilename,
        needsReview: d.needsReview,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  },
);

router.post(
  "/m/documents/upload",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = MUploadDocBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const id = newId("doc");
    const filename = parsed.data.filename || `${id}.bin`;
    const bytes = Buffer.from(parsed.data.contentBase64, "base64");
    const key = storage.buildKey({
      agencyId: AGENCY_ID,
      category: "documents",
      id,
      filename,
    });
    try {
      await storage.uploadBytes(
        key,
        bytes,
        parsed.data.contentType ?? "application/octet-stream",
      );
    } catch (err) {
      // Fail-fast: don't insert a DB row that points at a missing blob, or
      // the caregiver UI will keep the document in PENDING forever and the
      // classifier will dispatch on a non-existent file.
      req.log.error({ err }, "object storage upload failed");
      res.status(503).json({
        error: "document storage unavailable — please retry",
      });
      return;
    }
    const [row] = await db
      .insert(caregiverDocumentsTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        caregiverId,
        documentType: parsed.data.documentType ?? "OTHER",
        issuedDate: parsed.data.issuedDate ?? null,
        expirationDate: parsed.data.expirationDate ?? null,
        fileObjectKey: key,
        originalFilename: filename,
        classificationStatus: "PENDING",
        needsReview: false,
      })
      .returning();
    await recordAudit(
      { id: caregiverId, name: "Caregiver (mobile)" },
      {
        action: "UPLOAD_DOCUMENT",
        entityType: "CaregiverDocument",
        entityId: id,
        summary: `Caregiver self-uploaded ${filename} — auto-classifying`,
        afterState: row,
      },
    );
    try {
      await dispatch(
        "ocr.extract-document",
        { documentId: id, objectKey: key },
        processDocumentClassify,
      );
    } catch (err) {
      req.log.warn({ err }, "failed to dispatch classifier");
    }
    res.status(201).json({
      id: row.id,
      documentType: row.documentType,
      classificationStatus: row.classificationStatus,
      originalFilename: row.originalFilename,
      createdAt: row.createdAt.toISOString(),
    });
  },
);

export default router;
