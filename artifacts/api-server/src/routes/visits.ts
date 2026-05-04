import { Router, type IRouter } from "express";
import { and, eq, gte, lte, desc, inArray } from "drizzle-orm";
import {
  db,
  visitsTable,
  schedulesTable,
  clientsTable,
  caregiversTable,
  complianceAlertsTable,
  carePlansTable,
  visitChecklistInstancesTable,
} from "@workspace/db";
import {
  ListVisitsQueryParams,
  ListVisitsResponse,
  ClockInBody,
  ClockInResponse,
  ClockOutParams,
  ClockOutBody,
  ClockOutResponse,
  VerifyVisitParams,
  VerifyVisitBody,
  VerifyVisitResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { dispatchNotificationToUsers } from "../lib/notify";

const router: IRouter = Router();

function formatVisitRow(
  v: typeof visitsTable.$inferSelect,
  clientMap: Map<string, typeof clientsTable.$inferSelect>,
  cgMap: Map<string, typeof caregiversTable.$inferSelect>,
) {
  const c = clientMap.get(v.clientId);
  const cg = cgMap.get(v.caregiverId);
  return {
    id: v.id,
    scheduleId: v.scheduleId,
    caregiverId: v.caregiverId,
    caregiverName: cg ? `${cg.firstName} ${cg.lastName}` : "Unknown",
    clientId: v.clientId,
    clientName: c ? `${c.firstName} ${c.lastName}` : "Unknown",
    clockInTime: v.clockInTime,
    clockInLat: v.clockInLat == null ? null : Number(v.clockInLat),
    clockInLng: v.clockInLng == null ? null : Number(v.clockInLng),
    clockInMethod: v.clockInMethod,
    clockOutTime: v.clockOutTime,
    clockOutLat: v.clockOutLat == null ? null : Number(v.clockOutLat),
    clockOutLng: v.clockOutLng == null ? null : Number(v.clockOutLng),
    clockOutMethod: v.clockOutMethod,
    durationMinutes: v.durationMinutes,
    tasksCompleted: v.tasksCompleted,
    caregiverNotes: v.caregiverNotes,
    supervisorNotes: v.supervisorNotes,
    verificationStatus: v.verificationStatus,
    exceptionReason: v.exceptionReason,
    geoFenceMatch: v.geoFenceMatch,
    hasIncident: v.hasIncident ?? false,
    clientSignatureId: v.clientSignatureId ?? null,
  };
}

async function batchFormatVisits(rows: (typeof visitsTable.$inferSelect)[]) {
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const cgIds = [...new Set(rows.map((r) => r.caregiverId))];
  const [clients, cgs] = await Promise.all([
    clientIds.length
      ? db
          .select()
          .from(clientsTable)
          .where(inArray(clientsTable.id, clientIds))
      : [],
    cgIds.length
      ? db
          .select()
          .from(caregiversTable)
          .where(inArray(caregiversTable.id, cgIds))
      : [],
  ]);
  const clientMap = new Map(clients.map((c) => [c.id, c]));
  const cgMap = new Map(cgs.map((c) => [c.id, c]));
  return rows.map((r) => formatVisitRow(r, clientMap, cgMap));
}

async function format(v: typeof visitsTable.$inferSelect) {
  const result = await batchFormatVisits([v]);
  return result[0]!;
}

router.get("/visits", async (req, res): Promise<void> => {
  // Coerce ISO date strings to Date before zod validation; clients (incl.
  // generated React Query hooks) pass query params as strings.
  const rawQ = req.query as Record<string, unknown>;
  const coerced: Record<string, unknown> = { ...rawQ };
  if (typeof rawQ.from === "string" && rawQ.from) coerced.from = new Date(rawQ.from);
  if (typeof rawQ.to === "string" && rawQ.to) coerced.to = new Date(rawQ.to);
  const parsed = ListVisitsQueryParams.safeParse(coerced);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(visitsTable.agencyId, AGENCY_ID)];
  if (parsed.data.status)
    conds.push(eq(visitsTable.verificationStatus, parsed.data.status));
  if (parsed.data.from)
    conds.push(gte(visitsTable.clockInTime, parsed.data.from));
  if (parsed.data.to)
    conds.push(lte(visitsTable.clockInTime, parsed.data.to));
  const rows = await db
    .select()
    .from(visitsTable)
    .where(and(...conds))
    .orderBy(desc(visitsTable.clockInTime));
  const formatted = await batchFormatVisits(rows);
  res.json(ListVisitsResponse.parse(formatted));
});

router.post("/visits/clock-in", async (req, res): Promise<void> => {
  const parsed = ClockInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let scheduleId: string | null = null;
  if (parsed.data.scheduleId) {
    const [sch] = await db
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.id, parsed.data.scheduleId));
    if (!sch) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    scheduleId = sch.id;
    await db
      .update(schedulesTable)
      .set({ status: "IN_PROGRESS" })
      .where(eq(schedulesTable.id, sch.id));
  }
  // Snapshot the client's active care plan onto the visit so a mid-shift
  // edit doesn't change what the caregiver was supposed to do.
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, parsed.data.clientId));
  let carePlanId: string | null = null;
  let carePlanVersion: number | null = null;
  let snapshotPlanTasks: Array<Record<string, unknown>> = [];
  if (client?.activeCarePlanId) {
    const [plan] = await db
      .select()
      .from(carePlansTable)
      .where(eq(carePlansTable.id, client.activeCarePlanId));
    if (plan) {
      carePlanId = plan.id;
      carePlanVersion = plan.version;
      snapshotPlanTasks = (plan.tasks as Array<Record<string, unknown>>) ?? [];
    }
  }
  const id = newId("vis");
  const now = new Date();
  const occurredAt = parsed.data.occurredAt
    ? new Date(parsed.data.occurredAt)
    : now;
  const wasOffline = parsed.data.occurredAt != null && occurredAt < now;
  const [row] = await db
    .insert(visitsTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      scheduleId,
      caregiverId: parsed.data.caregiverId,
      clientId: parsed.data.clientId,
      clockInTime: occurredAt,
      clockInLat:
        parsed.data.latitude != null ? String(parsed.data.latitude) : null,
      clockInLng:
        parsed.data.longitude != null ? String(parsed.data.longitude) : null,
      clockInMethod: parsed.data.method ?? "GPS",
      verificationStatus: "PENDING",
      geoFenceMatch: true,
      offlineSyncedAt: wasOffline ? now : null,
      carePlanId,
      carePlanVersion,
    })
    .returning();
  // Snapshot the active care plan tasks into a checklist instance the
  // caregiver will tick off bedside. Mid-shift care plan edits won't change
  // what was already snapshotted.
  if (snapshotPlanTasks.length > 0) {
    const snapshotTasks = snapshotPlanTasks
      .slice()
      .sort((a, b) => {
        const ao = typeof a.ordering === "number" ? a.ordering : 0;
        const bo = typeof b.ordering === "number" ? b.ordering : 0;
        return ao - bo;
      })
      .map((t) => ({
        taskId: typeof t.id === "string" ? t.id : newId("vct"),
        title: typeof t.title === "string" ? t.title : "Task",
        category: typeof t.category === "string" ? t.category : "OTHER",
        instructions:
          typeof t.instructions === "string" ? t.instructions : null,
        requiresPhoto: Boolean(t.requiresPhoto),
        completed: false,
        completedAt: null,
        photoUrl: null,
        skippedReason: null,
      }));
    await db.insert(visitChecklistInstancesTable).values({
      id: newId("vci"),
      agencyId: AGENCY_ID,
      visitId: id,
      carePlanId,
      carePlanVersion,
      tasks: snapshotTasks,
    });
  }
  await recordAudit(req.user, {
    action: "CLOCK_IN",
    entityType: "Visit",
    entityId: id,
    summary: `Clock-in recorded`,
    afterState: row,
  });
  res.status(201).json(ClockInResponse.parse(await format(row)));
});

router.post("/visits/:id/clock-out", async (req, res): Promise<void> => {
  const params = ClockOutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ClockOutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(visitsTable)
    .where(
      and(eq(visitsTable.agencyId, AGENCY_ID), eq(visitsTable.id, params.data.id)),
    );
  if (!existing) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }
  const now = new Date();
  const occurredAt = parsed.data.occurredAt
    ? new Date(parsed.data.occurredAt)
    : now;
  const wasOffline = parsed.data.occurredAt != null && occurredAt < now;
  const dur = existing.clockInTime
    ? Math.round((occurredAt.getTime() - existing.clockInTime.getTime()) / 60000)
    : 0;
  const exception = dur > 0 && dur < 30 ? "EXCEPTION" : "PENDING";
  const exceptionReason =
    dur > 0 && dur < 30 ? "Visit shorter than 30 minutes" : null;
  const [row] = await db
    .update(visitsTable)
    .set({
      clockOutTime: occurredAt,
      clockOutLat:
        parsed.data.latitude != null ? String(parsed.data.latitude) : null,
      clockOutLng:
        parsed.data.longitude != null ? String(parsed.data.longitude) : null,
      clockOutMethod: parsed.data.method ?? "GPS",
      durationMinutes: dur,
      tasksCompleted: parsed.data.tasksCompleted ?? [],
      caregiverNotes: parsed.data.caregiverNotes ?? null,
      verificationStatus: exception,
      exceptionReason,
      geoFenceMatch: true,
      offlineSyncedAt: wasOffline ? now : existing.offlineSyncedAt,
    })
    .where(eq(visitsTable.id, existing.id))
    .returning();
  if (existing.scheduleId) {
    await db
      .update(schedulesTable)
      .set({ status: "COMPLETED" })
      .where(eq(schedulesTable.id, existing.scheduleId));
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
  await recordAudit(req.user, {
    action: exception === "EXCEPTION" ? "VISIT_EXCEPTION" : "CLOCK_OUT",
    entityType: "Visit",
    entityId: row.id,
    summary: `Clock-out · ${dur} min${exception === "EXCEPTION" ? " (flagged)" : ""}`,
    afterState: row,
  });
  res.json(ClockOutResponse.parse(await format(row)));
});

router.post("/visits/:id/verify", async (req, res): Promise<void> => {
  const params = VerifyVisitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = VerifyVisitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const newStatus = parsed.data.decision;
  const [row] = await db
    .update(visitsTable)
    .set({
      verificationStatus: newStatus,
      supervisorNotes: parsed.data.supervisorNotes ?? null,
    })
    .where(
      and(eq(visitsTable.agencyId, AGENCY_ID), eq(visitsTable.id, params.data.id)),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }
  await recordAudit(req.user, {
    action: "VERIFY_VISIT",
    entityType: "Visit",
    entityId: row.id,
    summary: `Visit ${newStatus.toLowerCase()}`,
    afterState: row,
  });
  if (newStatus === "VERIFIED") {
    try {
      const [cg] = await db
        .select({ userId: caregiversTable.userId })
        .from(caregiversTable)
        .where(eq(caregiversTable.id, row.caregiverId))
        .limit(1);
      if (cg?.userId) {
        await dispatchNotificationToUsers({
          notificationTypeId: "visit.verified",
          recipients: [{ userId: cg.userId, userRole: "CAREGIVER" }],
          payload: {
            subject: "Visit verified",
            body: `Your visit on ${row.clockInTime?.toISOString().slice(0, 10) ?? ""} was approved.`,
            url: `/m/`,
            visitId: row.id,
          },
        });
      }
    } catch {
      /* ignore */
    }
  }
  res.json(VerifyVisitResponse.parse(await format(row)));
});

export default router;
