import { Router, type IRouter } from "express";
import { and, eq, gte, lt, asc } from "drizzle-orm";
import {
  db,
  schedulesTable,
  clientsTable,
  visitsTable,
  carePlansTable,
} from "@workspace/db";
import { AGENCY_ID } from "../../lib/agency";
import { requireCaregiverSession, type MAuthedRequest } from "./middleware";

const router: IRouter = Router();

router.get(
  "/m/schedule",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const rows = await db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.agencyId, AGENCY_ID),
          eq(schedulesTable.caregiverId, caregiverId),
          gte(schedulesTable.startTime, start),
          lt(schedulesTable.startTime, end),
        ),
      )
      .orderBy(asc(schedulesTable.startTime));

    const clientIds = Array.from(new Set(rows.map((r) => r.clientId)));
    const clients = clientIds.length
      ? await db
          .select()
          .from(clientsTable)
          .where(eq(clientsTable.agencyId, AGENCY_ID))
      : [];
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    const scheduleIds = rows.map((r) => r.id);
    const visits = scheduleIds.length
      ? await db
          .select()
          .from(visitsTable)
          .where(eq(visitsTable.agencyId, AGENCY_ID))
      : [];
    const visitByScheduleId = new Map(
      visits.filter((v) => v.scheduleId).map((v) => [v.scheduleId!, v]),
    );

    const carePlans = clientIds.length
      ? await db
          .select()
          .from(carePlansTable)
          .where(
            and(
              eq(carePlansTable.agencyId, AGENCY_ID),
              eq(carePlansTable.status, "ACTIVE"),
            ),
          )
      : [];
    const planByClientId = new Map<string, typeof carePlans[number]>();
    for (const p of carePlans) {
      const existing = planByClientId.get(p.clientId);
      if (!existing || (p.version > existing.version)) {
        planByClientId.set(p.clientId, p);
      }
    }

    const entries = rows.map((s) => {
      const c = clientMap.get(s.clientId);
      const v = visitByScheduleId.get(s.id);
      const plan = planByClientId.get(s.clientId);
      return {
        scheduleId: s.id,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        scheduledMinutes: s.scheduledMinutes,
        serviceCode: s.serviceCode,
        serviceDescription: s.serviceDescription,
        status: s.status,
        notes: s.notes,
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
        carePlanTitle: plan?.title ?? null,
        carePlanId: plan?.id ?? null,
        carePlanVersion: plan?.version ?? null,
        carePlanTasks: Array.isArray(plan?.tasks)
          ? (plan.tasks as Array<Record<string, unknown>>).map((t, i) => ({
              id: String(t.id ?? `t${i}`),
              label: String(t.title ?? t.label ?? `Task ${i + 1}`),
            }))
          : [],
        visitId: v?.id ?? null,
        visitStatus: v?.verificationStatus ?? null,
      };
    });

    // Group by date
    const days = new Map<string, typeof entries>();
    for (const e of entries) {
      const day = e.startTime.slice(0, 10);
      if (!days.has(day)) days.set(day, []);
      days.get(day)!.push(e);
    }
    const orderedDays = Array.from(days.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, es]) => ({ date, entries: es }));

    const now = Date.now();
    const nextEntry = entries.find(
      (e) => new Date(e.startTime).getTime() >= now && e.status !== "COMPLETED",
    );

    res.json({
      days: orderedDays,
      nextEntry: nextEntry ?? undefined,
    });
  },
);

export default router;
