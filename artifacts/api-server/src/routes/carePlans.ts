import { Router, type IRouter } from "express";
import { and, eq, desc, asc } from "drizzle-orm";
import {
  db,
  carePlansTable,
  carePlanAcknowledgmentsTable,
  taskTemplatesTable,
  clientsTable,
  authorizationsTable,
  familyUsersTable,
} from "@workspace/db";
import {
  ListCarePlansQueryParams,
  ListCarePlansResponse,
  CreateCarePlanBody,
  GetCarePlanParams,
  GetCarePlanResponse,
  UpdateCarePlanParams,
  UpdateCarePlanBody,
  SubmitCarePlanParams,
  SubmitCarePlanBody,
  ApproveCarePlanParams,
  ApproveCarePlanBody,
  RejectCarePlanParams,
  RejectCarePlanBody,
  AcknowledgeCarePlanParams,
  AcknowledgeCarePlanBody,
  AcknowledgeCarePlanResponse,
  ListClientCarePlansParams,
  ListClientCarePlansResponse,
  GetActiveCarePlanParams,
  GetActiveCarePlanResponse,
  GenerateCarePlanFromAuthorizationParams,
  GenerateCarePlanFromAuthorizationBody,
  ListTaskTemplatesResponse,
  ListPendingFamilyAcknowledgmentsQueryParams,
  ListPendingFamilyAcknowledgmentsResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { draftCarePlanFromAuthorization } from "../lib/carePlanDrafter";

const router: IRouter = Router();

const APPROVER_USER = "user_admin";

async function fetchAcknowledgments(carePlanId: string) {
  const rows = await db
    .select({
      ack: carePlanAcknowledgmentsTable,
      family: familyUsersTable,
    })
    .from(carePlanAcknowledgmentsTable)
    .leftJoin(
      familyUsersTable,
      eq(carePlanAcknowledgmentsTable.familyUserId, familyUsersTable.id),
    )
    .where(eq(carePlanAcknowledgmentsTable.carePlanId, carePlanId))
    .orderBy(desc(carePlanAcknowledgmentsTable.acknowledgedAt));
  return rows.map(({ ack, family }) => ({
    id: ack.id,
    carePlanId: ack.carePlanId,
    familyUserId: ack.familyUserId,
    familyUserName: family
      ? `${family.firstName} ${family.lastName}`
      : "Family member",
    acknowledgedAt: ack.acknowledgedAt,
    notes: ack.notes,
  }));
}

async function formatPlan(p: typeof carePlansTable.$inferSelect) {
  const [client] = await db
    .select({ activeCarePlanId: clientsTable.activeCarePlanId })
    .from(clientsTable)
    .where(eq(clientsTable.id, p.clientId));
  const acknowledgments = await fetchAcknowledgments(p.id);
  return {
    id: p.id,
    clientId: p.clientId,
    version: p.version,
    status: p.status,
    title: p.title,
    goals: p.goals as unknown[],
    tasks: p.tasks as unknown[],
    riskFactors: p.riskFactors as unknown[],
    preferences: p.preferences as Record<string, unknown>,
    effectiveStart: p.effectiveStart,
    effectiveEnd: p.effectiveEnd,
    submittedBy: p.submittedBy,
    submittedAt: p.submittedAt,
    approvedBy: p.approvedBy,
    approvedAt: p.approvedAt,
    rejectedBy: p.rejectedBy,
    rejectedAt: p.rejectedAt,
    rejectionReason: p.rejectionReason,
    isActive: client?.activeCarePlanId === p.id,
    sourceAgentRunId: p.sourceAgentRunId,
    acknowledgments,
    createdAt: p.createdAt,
  };
}

function nextVersion(existing: { version: number }[]): number {
  return existing.reduce((max, p) => Math.max(max, p.version), 0) + 1;
}

function normalizeTasks(tasks: unknown): unknown[] {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((t, idx) => {
    const task = (t as Record<string, unknown>) ?? {};
    return {
      id: typeof task.id === "string" ? task.id : newId("cpt"),
      templateId: task.templateId ?? null,
      category: task.category ?? "OTHER",
      title: task.title ?? "Untitled task",
      instructions: task.instructions ?? null,
      frequency: task.frequency ?? "PER_VISIT",
      ordering:
        typeof task.ordering === "number" ? task.ordering : idx,
      requiresPhoto: Boolean(task.requiresPhoto),
    };
  });
}

router.get("/task-templates", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(taskTemplatesTable)
    .where(
      and(
        eq(taskTemplatesTable.agencyId, AGENCY_ID),
        eq(taskTemplatesTable.isActive, 1),
      ),
    )
    .orderBy(asc(taskTemplatesTable.category), asc(taskTemplatesTable.title));
  res.json(
    ListTaskTemplatesResponse.parse(
      rows.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        description: r.description,
        defaultMinutes: r.defaultMinutes,
        defaultFrequency: r.defaultFrequency,
        requiresPhoto: r.requiresPhoto === 1,
      })),
    ),
  );
});

router.get("/care-plans", async (req, res): Promise<void> => {
  const parsed = ListCarePlansQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(carePlansTable.agencyId, AGENCY_ID)];
  if (parsed.data.clientId)
    conds.push(eq(carePlansTable.clientId, parsed.data.clientId));
  if (parsed.data.status)
    conds.push(eq(carePlansTable.status, parsed.data.status));
  const rows = await db
    .select()
    .from(carePlansTable)
    .where(and(...conds))
    .orderBy(desc(carePlansTable.createdAt));
  const formatted = await Promise.all(rows.map(formatPlan));
  res.json(ListCarePlansResponse.parse(formatted));
});

router.post("/care-plans", async (req, res): Promise<void> => {
  const parsed = CreateCarePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db
    .select({ version: carePlansTable.version })
    .from(carePlansTable)
    .where(
      and(
        eq(carePlansTable.agencyId, AGENCY_ID),
        eq(carePlansTable.clientId, parsed.data.clientId),
      ),
    );
  const version = nextVersion(existing);
  const id = newId("cp");
  const [row] = await db
    .insert(carePlansTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      clientId: parsed.data.clientId,
      version,
      status: "DRAFT",
      title: parsed.data.title,
      goals: parsed.data.goals ?? [],
      tasks: normalizeTasks(parsed.data.tasks),
      riskFactors: parsed.data.riskFactors ?? [],
      preferences: parsed.data.preferences ?? {},
      authoredBy: APPROVER_USER,
      sourceAgentRunId: parsed.data.sourceAgentRunId ?? null,
    })
    .returning();
  await recordAudit({
    action: "CREATE_CARE_PLAN",
    entityType: "CarePlan",
    entityId: id,
    summary: `Care plan v${version} drafted: ${row.title}`,
    afterState: row,
  });
  res.status(201).json(GetCarePlanResponse.parse(await formatPlan(row)));
});

router.get("/care-plans/:id", async (req, res): Promise<void> => {
  const params = GetCarePlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(carePlansTable)
    .where(
      and(
        eq(carePlansTable.agencyId, AGENCY_ID),
        eq(carePlansTable.id, params.data.id),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Care plan not found" });
    return;
  }
  res.json(GetCarePlanResponse.parse(await formatPlan(row)));
});

router.patch("/care-plans/:id", async (req, res): Promise<void> => {
  const params = UpdateCarePlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCarePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(carePlansTable)
    .where(
      and(
        eq(carePlansTable.agencyId, AGENCY_ID),
        eq(carePlansTable.id, params.data.id),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Care plan not found" });
    return;
  }
  if (existing.status !== "DRAFT" && existing.status !== "REJECTED") {
    res.status(409).json({
      error: "Only DRAFT or REJECTED care plans can be edited",
    });
    return;
  }
  const update: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.goals !== undefined) update.goals = parsed.data.goals;
  if (parsed.data.tasks !== undefined)
    update.tasks = normalizeTasks(parsed.data.tasks);
  if (parsed.data.riskFactors !== undefined)
    update.riskFactors = parsed.data.riskFactors;
  if (parsed.data.preferences !== undefined)
    update.preferences = parsed.data.preferences;
  // Editing a rejected plan flips it back to draft.
  if (existing.status === "REJECTED") update.status = "DRAFT";
  const [row] = await db
    .update(carePlansTable)
    .set(update)
    .where(eq(carePlansTable.id, existing.id))
    .returning();
  await recordAudit({
    action: "UPDATE_CARE_PLAN",
    entityType: "CarePlan",
    entityId: row.id,
    summary: `Care plan v${row.version} edited`,
    afterState: row,
  });
  res.json(GetCarePlanResponse.parse(await formatPlan(row)));
});

router.post("/care-plans/:id/submit", async (req, res): Promise<void> => {
  const params = SubmitCarePlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // body is optional
  SubmitCarePlanBody.safeParse(req.body ?? {});
  const [existing] = await db
    .select()
    .from(carePlansTable)
    .where(
      and(
        eq(carePlansTable.agencyId, AGENCY_ID),
        eq(carePlansTable.id, params.data.id),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Care plan not found" });
    return;
  }
  if (existing.status !== "DRAFT") {
    res.status(409).json({ error: "Only DRAFT plans can be submitted" });
    return;
  }
  const [row] = await db
    .update(carePlansTable)
    .set({
      status: "SUBMITTED",
      submittedBy: APPROVER_USER,
      submittedAt: new Date(),
      rejectionReason: null,
      rejectedAt: null,
      rejectedBy: null,
    })
    .where(eq(carePlansTable.id, existing.id))
    .returning();
  await recordAudit({
    action: "SUBMIT_CARE_PLAN",
    entityType: "CarePlan",
    entityId: row.id,
    summary: `Care plan v${row.version} submitted for approval`,
    afterState: row,
  });
  res.json(GetCarePlanResponse.parse(await formatPlan(row)));
});

router.post("/care-plans/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveCarePlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ApproveCarePlanBody.safeParse(req.body ?? {});
  const effectiveStart = parsed.success && parsed.data.effectiveStart
    ? new Date(parsed.data.effectiveStart)
    : new Date();
  const [existing] = await db
    .select()
    .from(carePlansTable)
    .where(
      and(
        eq(carePlansTable.agencyId, AGENCY_ID),
        eq(carePlansTable.id, params.data.id),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Care plan not found" });
    return;
  }
  if (existing.status !== "SUBMITTED" && existing.status !== "DRAFT") {
    res.status(409).json({
      error: "Only DRAFT or SUBMITTED plans can be approved",
    });
    return;
  }
  // Archive any previously-active plan for this client.
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, existing.clientId));
  if (client?.activeCarePlanId && client.activeCarePlanId !== existing.id) {
    await db
      .update(carePlansTable)
      .set({ status: "ARCHIVED", effectiveEnd: effectiveStart })
      .where(eq(carePlansTable.id, client.activeCarePlanId));
  }
  const [row] = await db
    .update(carePlansTable)
    .set({
      status: "APPROVED",
      approvedBy: APPROVER_USER,
      approvedAt: new Date(),
      effectiveStart,
    })
    .where(eq(carePlansTable.id, existing.id))
    .returning();
  await db
    .update(clientsTable)
    .set({ activeCarePlanId: row.id })
    .where(eq(clientsTable.id, row.clientId));
  await recordAudit({
    action: "APPROVE_CARE_PLAN",
    entityType: "CarePlan",
    entityId: row.id,
    summary: `Care plan v${row.version} approved & activated`,
    afterState: row,
  });
  res.json(GetCarePlanResponse.parse(await formatPlan(row)));
});

router.post("/care-plans/:id/reject", async (req, res): Promise<void> => {
  const params = RejectCarePlanParams.safeParse(req.params);
  const parsed = RejectCarePlanBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res
      .status(400)
      .json({ error: !params.success ? params.error.message : parsed.error!.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(carePlansTable)
    .where(
      and(
        eq(carePlansTable.agencyId, AGENCY_ID),
        eq(carePlansTable.id, params.data.id),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Care plan not found" });
    return;
  }
  if (existing.status !== "SUBMITTED") {
    res.status(409).json({ error: "Only SUBMITTED plans can be rejected" });
    return;
  }
  const [row] = await db
    .update(carePlansTable)
    .set({
      status: "REJECTED",
      rejectedBy: APPROVER_USER,
      rejectedAt: new Date(),
      rejectionReason: parsed.data.reason,
    })
    .where(eq(carePlansTable.id, existing.id))
    .returning();
  await recordAudit({
    action: "REJECT_CARE_PLAN",
    entityType: "CarePlan",
    entityId: row.id,
    summary: `Care plan v${row.version} rejected: ${parsed.data.reason}`,
    afterState: row,
  });
  res.json(GetCarePlanResponse.parse(await formatPlan(row)));
});

router.post("/care-plans/:id/acknowledge", async (req, res): Promise<void> => {
  const params = AcknowledgeCarePlanParams.safeParse(req.params);
  const parsed = AcknowledgeCarePlanBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res
      .status(400)
      .json({ error: !params.success ? params.error.message : parsed.error!.message });
    return;
  }
  const [plan] = await db
    .select()
    .from(carePlansTable)
    .where(
      and(
        eq(carePlansTable.agencyId, AGENCY_ID),
        eq(carePlansTable.id, params.data.id),
      ),
    );
  if (!plan) {
    res.status(404).json({ error: "Care plan not found" });
    return;
  }
  const [family] = await db
    .select()
    .from(familyUsersTable)
    .where(eq(familyUsersTable.id, parsed.data.familyUserId));
  if (!family) {
    res.status(404).json({ error: "Family user not found" });
    return;
  }
  const id = newId("cpa");
  const [ack] = await db
    .insert(carePlanAcknowledgmentsTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      carePlanId: plan.id,
      familyUserId: family.id,
      notes: parsed.data.notes ?? null,
    })
    .returning();
  await recordAudit({
    action: "ACKNOWLEDGE_CARE_PLAN",
    entityType: "CarePlan",
    entityId: plan.id,
    summary: `${family.firstName} ${family.lastName} acknowledged care plan v${plan.version}`,
    afterState: ack,
  });
  res.json(
    AcknowledgeCarePlanResponse.parse({
      id: ack.id,
      carePlanId: ack.carePlanId,
      familyUserId: ack.familyUserId,
      familyUserName: `${family.firstName} ${family.lastName}`,
      acknowledgedAt: ack.acknowledgedAt,
      notes: ack.notes,
    }),
  );
});

router.get("/clients/:id/care-plans", async (req, res): Promise<void> => {
  const params = ListClientCarePlansParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(carePlansTable)
    .where(
      and(
        eq(carePlansTable.agencyId, AGENCY_ID),
        eq(carePlansTable.clientId, params.data.id),
      ),
    )
    .orderBy(desc(carePlansTable.version));
  const formatted = await Promise.all(rows.map(formatPlan));
  res.json(ListClientCarePlansResponse.parse(formatted));
});

router.get("/clients/:id/care-plan/active", async (req, res): Promise<void> => {
  const params = GetActiveCarePlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.agencyId, AGENCY_ID),
        eq(clientsTable.id, params.data.id),
      ),
    );
  if (!client?.activeCarePlanId) {
    res.status(404).json({ error: "No active care plan for client" });
    return;
  }
  const [row] = await db
    .select()
    .from(carePlansTable)
    .where(eq(carePlansTable.id, client.activeCarePlanId));
  if (!row) {
    res.status(404).json({ error: "Active care plan not found" });
    return;
  }
  res.json(GetActiveCarePlanResponse.parse(await formatPlan(row)));
});

router.post(
  "/clients/:id/care-plans/generate",
  async (req, res): Promise<void> => {
    const params = GenerateCarePlanFromAuthorizationParams.safeParse(
      req.params,
    );
    const parsed = GenerateCarePlanFromAuthorizationBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res
        .status(400)
        .json({
          error: !params.success ? params.error.message : parsed.error!.message,
        });
      return;
    }
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(
        and(
          eq(clientsTable.agencyId, AGENCY_ID),
          eq(clientsTable.id, params.data.id),
        ),
      );
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const [auth] = await db
      .select()
      .from(authorizationsTable)
      .where(
        and(
          eq(authorizationsTable.agencyId, AGENCY_ID),
          eq(authorizationsTable.id, parsed.data.authorizationId),
          eq(authorizationsTable.clientId, client.id),
        ),
      );
    if (!auth) {
      res.status(404).json({ error: "Authorization not found" });
      return;
    }
    const templates = await db
      .select()
      .from(taskTemplatesTable)
      .where(
        and(
          eq(taskTemplatesTable.agencyId, AGENCY_ID),
          eq(taskTemplatesTable.isActive, 1),
        ),
      );
    const draft = await draftCarePlanFromAuthorization({
      client,
      authorization: auth,
      templates,
    });
    const existing = await db
      .select({ version: carePlansTable.version })
      .from(carePlansTable)
      .where(
        and(
          eq(carePlansTable.agencyId, AGENCY_ID),
          eq(carePlansTable.clientId, client.id),
        ),
      );
    const version = nextVersion(existing);
    const id = newId("cp");
    const [row] = await db
      .insert(carePlansTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        clientId: client.id,
        version,
        status: "DRAFT",
        title: draft.title,
        goals: draft.goals,
        tasks: normalizeTasks(draft.tasks),
        riskFactors: draft.riskFactors,
        preferences: draft.preferences,
        authoredBy: APPROVER_USER,
        sourceAgentRunId: draft.agentRunId,
      })
      .returning();
    await recordAudit({
      action: "GENERATE_CARE_PLAN",
      entityType: "CarePlan",
      entityId: id,
      summary: `AI-drafted care plan v${version} from auth ${auth.authNumber}`,
      afterState: row,
    });
    res
      .status(201)
      .json(GetCarePlanResponse.parse(await formatPlan(row)));
  },
);

router.get(
  "/family/pending-acknowledgments",
  async (req, res): Promise<void> => {
    const parsed =
      ListPendingFamilyAcknowledgmentsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Find all approved & active plans (one per client) where this family
    // user (if specified) hasn't acknowledged yet.
    const clientRows = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.agencyId, AGENCY_ID));
    const result: Array<{
      carePlanId: string;
      clientId: string;
      clientName: string;
      version: number;
      title: string;
      approvedAt: Date;
    }> = [];
    for (const c of clientRows) {
      if (!c.activeCarePlanId) continue;
      const [plan] = await db
        .select()
        .from(carePlansTable)
        .where(eq(carePlansTable.id, c.activeCarePlanId));
      if (!plan?.approvedAt) continue;
      if (parsed.data.familyUserId) {
        const [ack] = await db
          .select()
          .from(carePlanAcknowledgmentsTable)
          .where(
            and(
              eq(carePlanAcknowledgmentsTable.carePlanId, plan.id),
              eq(
                carePlanAcknowledgmentsTable.familyUserId,
                parsed.data.familyUserId,
              ),
            ),
          );
        if (ack) continue;
      }
      result.push({
        carePlanId: plan.id,
        clientId: c.id,
        clientName: `${c.firstName} ${c.lastName}`,
        version: plan.version,
        title: plan.title,
        approvedAt: plan.approvedAt,
      });
    }
    res.json(ListPendingFamilyAcknowledgmentsResponse.parse(result));
  },
);

export default router;
