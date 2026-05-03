import { Router, type IRouter } from "express";
import { and, eq, gte, lte, or, sql, lt, gt } from "drizzle-orm";
import {
  db,
  schedulesTable,
  clientsTable,
  caregiversTable,
} from "@workspace/db";
import {
  ListSchedulesQueryParams,
  ListSchedulesResponse,
  CreateScheduleBody,
  UpdateScheduleParams,
  UpdateScheduleBody,
  UpdateScheduleResponse,
  DeleteScheduleParams,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();

async function format(s: typeof schedulesTable.$inferSelect) {
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, s.clientId));
  const [caregiver] = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.id, s.caregiverId));
  return {
    id: s.id,
    clientId: s.clientId,
    clientName: client ? `${client.firstName} ${client.lastName}` : "Unknown",
    caregiverId: s.caregiverId,
    caregiverName: caregiver
      ? `${caregiver.firstName} ${caregiver.lastName}`
      : "Unknown",
    startTime: s.startTime,
    endTime: s.endTime,
    scheduledMinutes: s.scheduledMinutes,
    serviceCode: s.serviceCode,
    serviceDescription: s.serviceDescription,
    authorizationId: s.authorizationId,
    status: s.status,
    notes: s.notes,
  };
}

router.get("/schedules", async (req, res): Promise<void> => {
  const parsed = ListSchedulesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(schedulesTable.agencyId, AGENCY_ID)];
  if (parsed.data.from)
    conds.push(gte(schedulesTable.startTime, new Date(parsed.data.from)));
  if (parsed.data.to)
    conds.push(lte(schedulesTable.startTime, new Date(parsed.data.to)));
  if (parsed.data.caregiverId)
    conds.push(eq(schedulesTable.caregiverId, parsed.data.caregiverId));
  if (parsed.data.clientId)
    conds.push(eq(schedulesTable.clientId, parsed.data.clientId));
  const rows = await db
    .select()
    .from(schedulesTable)
    .where(and(...conds))
    .orderBy(schedulesTable.startTime);
  const formatted = await Promise.all(rows.map(format));
  res.json(ListSchedulesResponse.parse(formatted));
});

async function detectConflicts(
  caregiverId: string,
  start: Date,
  end: Date,
  excludeId?: string,
) {
  const overlaps = await db
    .select()
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        eq(schedulesTable.caregiverId, caregiverId),
        lt(schedulesTable.startTime, end),
        gt(schedulesTable.endTime, start),
      ),
    );
  return overlaps.filter((o) => o.id !== excludeId);
}

router.post("/schedules", async (req, res): Promise<void> => {
  const parsed = CreateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const start = parsed.data.startTime;
  const end = parsed.data.endTime;
  if (end <= start) {
    res.status(400).json({ error: "endTime must be after startTime" });
    return;
  }
  const conflicts = await detectConflicts(parsed.data.caregiverId, start, end);
  if (conflicts.length) {
    res.status(409).json({
      error: "Scheduling conflict",
      conflicts: conflicts.map((c) => ({
        scheduleId: c.id,
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    });
    return;
  }
  const id = newId("sch");
  const minutes = Math.round(
    (end.getTime() - start.getTime()) / 60000,
  );
  const [row] = await db
    .insert(schedulesTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      clientId: parsed.data.clientId,
      caregiverId: parsed.data.caregiverId,
      authorizationId: parsed.data.authorizationId ?? null,
      startTime: start,
      endTime: end,
      scheduledMinutes: minutes,
      serviceCode: parsed.data.serviceCode,
      serviceDescription:
        parsed.data.serviceDescription ?? "Home health aide services",
      status: "SCHEDULED",
      notes: parsed.data.notes ?? null,
    })
    .returning();
  const formatted = await format(row);
  await recordAudit({
    action: "CREATE_SCHEDULE",
    entityType: "Schedule",
    entityId: id,
    summary: `Scheduled ${formatted.caregiverName} → ${formatted.clientName} on ${start.toISOString().slice(0, 10)}`,
    afterState: row,
  });
  res.status(201).json(formatted);
});

router.patch("/schedules/:id", async (req, res): Promise<void> => {
  const params = UpdateScheduleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.startTime && parsed.data.endTime) {
    update.scheduledMinutes = Math.round(
      (parsed.data.endTime.getTime() - parsed.data.startTime.getTime()) /
        60000,
    );
  }
  const [row] = await db
    .update(schedulesTable)
    .set(update)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        eq(schedulesTable.id, params.data.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  const formatted = await format(row);
  await recordAudit({
    action: "UPDATE_SCHEDULE",
    entityType: "Schedule",
    entityId: row.id,
    summary: `Updated schedule for ${formatted.caregiverName}`,
    afterState: row,
  });
  res.json(UpdateScheduleResponse.parse(formatted));
});

router.delete("/schedules/:id", async (req, res): Promise<void> => {
  const params = DeleteScheduleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        eq(schedulesTable.id, params.data.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  await recordAudit({
    action: "DELETE_SCHEDULE",
    entityType: "Schedule",
    entityId: row.id,
    summary: `Cancelled schedule ${row.id}`,
    beforeState: row,
  });
  res.sendStatus(204);
});

export default router;
