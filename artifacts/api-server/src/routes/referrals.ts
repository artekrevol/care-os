import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  referralDraftsTable,
  clientsTable,
  authorizationsTable,
} from "@workspace/db";
import { storage } from "@workspace/services";
import {
  ListReferralDraftsResponse,
  GetReferralDraftParams,
  GetReferralDraftResponse,
  UploadReferralDraftBody,
  ApproveReferralDraftBody,
  ApproveReferralDraftParams,
  ApproveReferralDraftResponse,
  RejectReferralDraftParams,
  RejectReferralDraftResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { dispatch } from "../lib/dispatch";
import { processReferralParse } from "../workers/referralParser";

const router: IRouter = Router();

function toApi(row: typeof referralDraftsTable.$inferSelect) {
  return {
    id: row.id,
    source: row.source,
    rawContent: row.rawContent,
    rawAttachmentUrl: row.rawAttachmentUrl
      ? storage.getPresignedReadUrl(row.rawAttachmentUrl).url
      : null,
    originalFilename:
      typeof (row.parsedFields as Record<string, unknown>)?.["_filename"] ===
      "string"
        ? ((row.parsedFields as Record<string, unknown>)["_filename"] as string)
        : null,
    parsedFields: (row.parsedFields ?? {}) as Record<string, unknown>,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    status: row.status,
    promotedClientId: row.promotedClientId,
    agentRunId: row.agentRunId,
    createdAt: row.createdAt,
  };
}

router.get("/referral-drafts", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(referralDraftsTable)
    .where(eq(referralDraftsTable.agencyId, AGENCY_ID))
    .orderBy(desc(referralDraftsTable.createdAt));
  res.json(ListReferralDraftsResponse.parse(rows.map(toApi)));
});

router.post("/referral-drafts", async (req, res): Promise<void> => {
  const parsed = UploadReferralDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = newId("ref");
  const filename = parsed.data.filename || `${id}.pdf`;
  const bytes = Buffer.from(parsed.data.contentBase64, "base64");
  const key = storage.buildKey({
    agencyId: AGENCY_ID,
    category: "referrals",
    id,
    filename,
  });
  try {
    await storage.uploadBytes(
      key,
      bytes,
      parsed.data.contentType ?? "application/pdf",
    );
  } catch (err) {
    req.log.warn({ err }, "object storage upload failed; continuing in memory");
  }
  const [row] = await db
    .insert(referralDraftsTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      source: "upload",
      rawAttachmentUrl: key,
      rawContent: filename,
      parsedFields: { _filename: filename, _bytes: bytes.length },
      status: "DRAFT",
    })
    .returning();
  await recordAudit({
    action: "UPLOAD_REFERRAL",
    entityType: "ReferralDraft",
    entityId: id,
    summary: `Uploaded referral PDF ${filename}`,
  });
  await dispatch(
    "ai.intake-referral",
    { referralDraftId: id },
    processReferralParse,
  );
  res.status(201).json(toApi(row));
});

router.get("/referral-drafts/:id", async (req, res): Promise<void> => {
  const params = GetReferralDraftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(referralDraftsTable)
    .where(
      and(
        eq(referralDraftsTable.agencyId, AGENCY_ID),
        eq(referralDraftsTable.id, params.data.id),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Referral draft not found" });
    return;
  }
  res.json(GetReferralDraftResponse.parse(toApi(row)));
});

router.post(
  "/referral-drafts/:id/approve",
  async (req, res): Promise<void> => {
    const params = ApproveReferralDraftParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = ApproveReferralDraftBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const [draft] = await db
      .select()
      .from(referralDraftsTable)
      .where(
        and(
          eq(referralDraftsTable.agencyId, AGENCY_ID),
          eq(referralDraftsTable.id, params.data.id),
        ),
      );
    if (!draft) {
      res.status(404).json({ error: "Referral draft not found" });
      return;
    }
    const c = body.data.client;
    const clientId = newId("clt");
    const dob = c.dob.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(clientsTable).values({
      id: clientId,
      agencyId: AGENCY_ID,
      firstName: c.firstName,
      lastName: c.lastName,
      dob,
      phone: c.phone ?? null,
      email: c.email ?? null,
      addressLine1: c.addressLine1 ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      postalCode: c.postalCode ?? null,
      primaryPayer: c.primaryPayer,
      status: "ACTIVE",
      intakeDate: today,
      languages: c.languages ?? [],
      carePreferences: c.carePreferences ?? null,
      allergies: c.allergies ?? null,
      emergencyContactName: c.emergencyContactName ?? null,
      emergencyContactPhone: c.emergencyContactPhone ?? null,
    });

    let authorizationId: string | null = null;
    if (body.data.authorization) {
      const a = body.data.authorization;
      authorizationId = newId("auth");
      const issued =
        a.issuedDate instanceof Date
          ? a.issuedDate.toISOString().slice(0, 10)
          : a.issuedDate;
      const exp =
        a.expirationDate instanceof Date
          ? a.expirationDate.toISOString().slice(0, 10)
          : a.expirationDate;
      await db.insert(authorizationsTable).values({
        id: authorizationId,
        agencyId: AGENCY_ID,
        clientId,
        payer: a.payer,
        authNumber: a.authNumber,
        issuedDate: issued,
        expirationDate: exp,
        approvedHoursPerWeek: String(a.approvedHoursPerWeek),
        approvedHoursTotal: String(a.approvedHoursTotal),
        hoursUsed: "0",
        scopeOfCare: a.scopeOfCare ?? [],
      });
    }

    await db
      .update(referralDraftsTable)
      .set({ status: "ACCEPTED", promotedClientId: clientId })
      .where(eq(referralDraftsTable.id, draft.id));
    await recordAudit({
      action: "APPROVE_REFERRAL",
      entityType: "ReferralDraft",
      entityId: draft.id,
      summary: `Approved referral → created ${c.firstName} ${c.lastName}${authorizationId ? ` + auth` : ""}`,
    });
    res.json(
      ApproveReferralDraftResponse.parse({ clientId, authorizationId }),
    );
  },
);

router.post(
  "/referral-drafts/:id/reject",
  async (req, res): Promise<void> => {
    const params = RejectReferralDraftParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .update(referralDraftsTable)
      .set({ status: "REJECTED" })
      .where(
        and(
          eq(referralDraftsTable.agencyId, AGENCY_ID),
          eq(referralDraftsTable.id, params.data.id),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Referral draft not found" });
      return;
    }
    await recordAudit({
      action: "REJECT_REFERRAL",
      entityType: "ReferralDraft",
      entityId: row.id,
      summary: `Rejected referral draft`,
    });
    res.json(RejectReferralDraftResponse.parse(toApi(row)));
  },
);

export default router;
