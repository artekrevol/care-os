import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  caregiversTable,
  caregiverDocumentsTable,
} from "@workspace/db";
import {
  ListCaregiversQueryParams,
  ListCaregiversResponse,
  CreateCaregiverBody,
  GetCaregiverParams,
  GetCaregiverResponse,
  UpdateCaregiverParams,
  UpdateCaregiverBody,
  UpdateCaregiverResponse,
  ListCaregiverDocumentsParams,
  ListCaregiverDocumentsResponse,
  CreateCaregiverDocumentParams,
  CreateCaregiverDocumentBody,
  ListExpiringDocumentsResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { docStatus, daysUntil } from "../lib/derivedStatus";

const router: IRouter = Router();

function cgName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`;
}

function caregiverWithDocCounts(
  c: typeof caregiversTable.$inferSelect,
  docs: (typeof caregiverDocumentsTable.$inferSelect)[],
) {
  let valid = 0,
    expiring = 0,
    expired = 0;
  for (const d of docs) {
    const s = docStatus(d.expirationDate);
    if (s === "VALID") valid++;
    else if (s === "EXPIRING") expiring++;
    else if (s === "EXPIRED") expired++;
  }
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    employmentType: c.employmentType,
    hireDate: c.hireDate,
    status: c.status,
    languages: c.languages,
    skills: c.skills,
    payRate: Number(c.payRate),
    hasVehicle: c.hasVehicle,
    addressCity: c.addressCity,
    addressState: c.addressState,
    documentsValid: valid,
    documentsExpiring: expiring,
    documentsExpired: expired,
    createdAt: c.createdAt,
  };
}

function formatDoc(
  d: typeof caregiverDocumentsTable.$inferSelect,
  caregiverName: string,
) {
  return {
    id: d.id,
    caregiverId: d.caregiverId,
    caregiverName,
    documentType: d.documentType,
    issuedDate: d.issuedDate,
    expirationDate: d.expirationDate,
    status: docStatus(d.expirationDate),
    daysUntilExpiration: daysUntil(d.expirationDate),
    fileUrl: d.fileUrl,
  };
}

router.get("/caregivers", async (req, res): Promise<void> => {
  const parsed = ListCaregiversQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(caregiversTable.agencyId, AGENCY_ID)];
  if (parsed.data.status) conds.push(eq(caregiversTable.status, parsed.data.status));
  if (parsed.data.search) {
    const s = `%${parsed.data.search}%`;
    conds.push(or(ilike(caregiversTable.firstName, s), ilike(caregiversTable.lastName, s))!);
  }
  const cgs = await db
    .select()
    .from(caregiversTable)
    .where(and(...conds))
    .orderBy(caregiversTable.lastName);
  const ids = cgs.map((c) => c.id);
  const docs = ids.length
    ? await db
        .select()
        .from(caregiverDocumentsTable)
        .where(
          and(
            eq(caregiverDocumentsTable.agencyId, AGENCY_ID),
            sql`${caregiverDocumentsTable.caregiverId} = ANY(${ids})`,
          ),
        )
    : [];
  const docsByCg = new Map<string, (typeof caregiverDocumentsTable.$inferSelect)[]>();
  for (const d of docs) {
    if (!docsByCg.has(d.caregiverId)) docsByCg.set(d.caregiverId, []);
    docsByCg.get(d.caregiverId)!.push(d);
  }
  res.json(
    ListCaregiversResponse.parse(
      cgs.map((c) => caregiverWithDocCounts(c, docsByCg.get(c.id) ?? [])),
    ),
  );
});

router.post("/caregivers", async (req, res): Promise<void> => {
  const parsed = CreateCaregiverBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = newId("cg");
  const hire =
    parsed.data.hireDate instanceof Date
      ? parsed.data.hireDate.toISOString().slice(0, 10)
      : (parsed.data.hireDate ?? null);
  const [row] = await db
    .insert(caregiversTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      employmentType: parsed.data.employmentType ?? "W2",
      hireDate: hire,
      status: "ACTIVE",
      languages: parsed.data.languages ?? [],
      skills: parsed.data.skills ?? [],
      payRate: String(parsed.data.payRate),
      hasVehicle: parsed.data.hasVehicle ?? true,
      addressCity: parsed.data.addressCity ?? null,
      addressState: parsed.data.addressState ?? null,
    })
    .returning();
  await recordAudit({
    action: "CREATE_CAREGIVER",
    entityType: "Caregiver",
    entityId: id,
    summary: `Hired caregiver ${cgName(row)}`,
    afterState: row,
  });
  res.status(201).json(GetCaregiverResponse.parse({
    ...caregiverWithDocCounts(row, []),
    documents: [],
  }));
});

router.get("/caregivers/:id", async (req, res): Promise<void> => {
  const params = GetCaregiverParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [c] = await db
    .select()
    .from(caregiversTable)
    .where(
      and(eq(caregiversTable.agencyId, AGENCY_ID), eq(caregiversTable.id, params.data.id)),
    );
  if (!c) {
    res.status(404).json({ error: "Caregiver not found" });
    return;
  }
  const docs = await db
    .select()
    .from(caregiverDocumentsTable)
    .where(
      and(
        eq(caregiverDocumentsTable.agencyId, AGENCY_ID),
        eq(caregiverDocumentsTable.caregiverId, c.id),
      ),
    );
  res.json(
    GetCaregiverResponse.parse({
      ...caregiverWithDocCounts(c, docs),
      documents: docs.map((d) => formatDoc(d, cgName(c))),
    }),
  );
});

router.patch("/caregivers/:id", async (req, res): Promise<void> => {
  const params = UpdateCaregiverParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCaregiverBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.payRate != null) update.payRate = String(parsed.data.payRate);
  const [row] = await db
    .update(caregiversTable)
    .set(update)
    .where(
      and(eq(caregiversTable.agencyId, AGENCY_ID), eq(caregiversTable.id, params.data.id)),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Caregiver not found" });
    return;
  }
  const docs = await db
    .select()
    .from(caregiverDocumentsTable)
    .where(
      and(
        eq(caregiverDocumentsTable.agencyId, AGENCY_ID),
        eq(caregiverDocumentsTable.caregiverId, row.id),
      ),
    );
  await recordAudit({
    action: "UPDATE_CAREGIVER",
    entityType: "Caregiver",
    entityId: row.id,
    summary: `Updated caregiver ${cgName(row)}`,
    afterState: row,
  });
  res.json(UpdateCaregiverResponse.parse(caregiverWithDocCounts(row, docs)));
});

router.get("/caregivers/:id/documents", async (req, res): Promise<void> => {
  const params = ListCaregiverDocumentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [c] = await db
    .select()
    .from(caregiversTable)
    .where(
      and(eq(caregiversTable.agencyId, AGENCY_ID), eq(caregiversTable.id, params.data.id)),
    );
  if (!c) {
    res.status(404).json({ error: "Caregiver not found" });
    return;
  }
  const docs = await db
    .select()
    .from(caregiverDocumentsTable)
    .where(
      and(
        eq(caregiverDocumentsTable.agencyId, AGENCY_ID),
        eq(caregiverDocumentsTable.caregiverId, c.id),
      ),
    );
  res.json(
    ListCaregiverDocumentsResponse.parse(
      docs.map((d) => formatDoc(d, cgName(c))),
    ),
  );
});

router.post("/caregivers/:id/documents", async (req, res): Promise<void> => {
  const params = CreateCaregiverDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateCaregiverDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [c] = await db
    .select()
    .from(caregiversTable)
    .where(
      and(eq(caregiversTable.agencyId, AGENCY_ID), eq(caregiversTable.id, params.data.id)),
    );
  if (!c) {
    res.status(404).json({ error: "Caregiver not found" });
    return;
  }
  const issued =
    parsed.data.issuedDate instanceof Date
      ? parsed.data.issuedDate.toISOString().slice(0, 10)
      : (parsed.data.issuedDate ?? null);
  const exp =
    parsed.data.expirationDate instanceof Date
      ? parsed.data.expirationDate.toISOString().slice(0, 10)
      : (parsed.data.expirationDate ?? null);
  const id = newId("doc");
  const [row] = await db
    .insert(caregiverDocumentsTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      caregiverId: c.id,
      documentType: parsed.data.documentType,
      issuedDate: issued,
      expirationDate: exp,
      fileUrl: parsed.data.fileUrl ?? null,
    })
    .returning();
  await recordAudit({
    action: "CREATE_DOCUMENT",
    entityType: "CaregiverDocument",
    entityId: id,
    summary: `${row.documentType} added for ${cgName(c)}`,
    afterState: row,
  });
  res.status(201).json(formatDoc(row, cgName(c)));
});

router.get("/documents/expiring", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ doc: caregiverDocumentsTable, cg: caregiversTable })
    .from(caregiverDocumentsTable)
    .innerJoin(
      caregiversTable,
      eq(caregiverDocumentsTable.caregiverId, caregiversTable.id),
    )
    .where(eq(caregiverDocumentsTable.agencyId, AGENCY_ID));
  const formatted = rows
    .map(({ doc, cg }) => formatDoc(doc, cgName(cg)))
    .filter((d) => d.status === "EXPIRING" || d.status === "EXPIRED");
  res.json(ListExpiringDocumentsResponse.parse(formatted));
});

export default router;
