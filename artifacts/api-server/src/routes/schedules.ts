import { Router, type IRouter } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
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
  DeleteScheduleParams,
  DryRunScheduleBody,
  SuggestCaregiversBody,
} from "@workspace/api-zod";
import { queue } from "@workspace/services";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { startAgentRun, failAgentRun } from "../lib/agentRun";
import { runScheduleOptimizerJob } from "../lib/scheduleOptimizerWorker";
import { logger } from "../lib/logger";
import {
  validateSchedule,
  isBlocked,
  type ScheduleConflict,
} from "../lib/scheduleValidation";
import { projectOtImpact } from "../lib/scheduleProjection";
import {
  loadClient,
  loadEligibleCaregivers,
  scoreCaregiver,
  persistCompatibilityScore,
  type Scored,
} from "../lib/compatibilityScore";

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

function otImpactToConflict(
  impact: Awaited<ReturnType<typeof projectOtImpact>>,
): ScheduleConflict | null {
  if (impact.deltaOvertimeMinutes <= 0 && impact.deltaDoubleTimeMinutes <= 0) {
    return null;
  }
  const otHrs = impact.deltaOvertimeMinutes / 60;
  const dtHrs = impact.deltaDoubleTimeMinutes / 60;
  const parts: string[] = [];
  if (otHrs > 0) parts.push(`+${otHrs.toFixed(1)}h overtime`);
  if (dtHrs > 0) parts.push(`+${dtHrs.toFixed(1)}h double-time`);
  return {
    type: "OT_THRESHOLD",
    severity: "WARNING",
    message: `${parts.join(", ")} ($${impact.deltaCostUsd.toFixed(2)} extra labor cost).`,
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

router.post("/schedules/dry-run", async (req, res): Promise<void> => {
  const parsed = DryRunScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { caregiverId, clientId, startTime, endTime, scheduleId } = parsed.data;
  if (endTime <= startTime) {
    res.status(400).json({ error: "endTime must be after startTime" });
    return;
  }
  const [conflicts, otImpact] = await Promise.all([
    validateSchedule({
      caregiverId,
      clientId,
      startTime,
      endTime,
      excludeScheduleId: scheduleId,
    }),
    projectOtImpact({
      caregiverId,
      startTime,
      endTime,
      excludeScheduleId: scheduleId,
    }),
  ]);
  const otConflict = otImpactToConflict(otImpact);
  if (otConflict) conflicts.push(otConflict);
  res.json({ conflicts, blocked: isBlocked(conflicts), otImpact });
});

router.post("/schedules/suggest-caregivers", async (req, res): Promise<void> => {
  const parsed = SuggestCaregiversBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { clientId, startTime, endTime, scheduleId } = parsed.data;
  if (endTime <= startTime) {
    res.status(400).json({ error: "endTime must be after startTime" });
    return;
  }
  const client = await loadClient(clientId);
  if (!client) {
    res.status(404).json({ error: "client not found" });
    return;
  }
  const caregivers = await loadEligibleCaregivers();

  // Score and validate every eligible caregiver synchronously (cheap, no LLM).
  const scored: Scored[] = [];
  const cgConflicts: ScheduleConflict[][] = [];
  for (const cg of caregivers) {
    const [s, c] = await Promise.all([
      scoreCaregiver({
        caregiver: cg,
        client,
        startTime,
        endTime,
        excludeScheduleId: scheduleId,
      }),
      validateSchedule({
        caregiverId: cg.id,
        clientId,
        startTime,
        endTime,
        excludeScheduleId: scheduleId,
      }),
    ]);
    scored.push(s);
    cgConflicts.push(c);
  }
  const ranked = scored
    .map((s, i) => ({ ...s, conflicts: cgConflicts[i] ?? [] }))
    .sort((a, b) => {
      const aBlocked = isBlocked(a.conflicts) ? 1 : 0;
      const bBlocked = isBlocked(b.conflicts) ? 1 : 0;
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;
      return b.score - a.score;
    })
    .slice(0, 5);

  // Persist compatibility scores against an agent run.
  const { id: runId } = await startAgentRun({
    agentName: "schedule-optimizer",
    promptVersion: "v1",
    triggeredBy: "user_admin",
    triggerReason: "manual-suggest",
    inputSummary: `Suggest caregivers for ${client.firstName} ${client.lastName} ${startTime.toISOString()} → ${endTime.toISOString()}`,
    metadata: {
      clientId,
      scheduleId: scheduleId ?? null,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      clientName: `${client.firstName} ${client.lastName}`,
      languages: client.languages,
      carePreferences: client.carePreferences,
      fallRisk: client.fallRisk,
      cognitiveStatus: client.cognitiveStatus,
      top3: ranked.slice(0, 3).map((r) => ({
        caregiverId: r.caregiverId,
        name: r.caregiverName,
        score: r.score,
        factors: r.factors,
      })),
    },
  });
  for (const r of ranked) {
    await persistCompatibilityScore({
      caregiverId: r.caregiverId,
      clientId,
      score: r.score,
      factors: r.factors,
      agentRunId: runId,
    });
  }

  // Hand the LLM-reasoning step off to BullMQ. In dev (no Redis), run inline so
  // the response carries the enhanced reasoning; in prod the worker handles it
  // out-of-band and clients fetch via /agent-runs/:id.
  const reasoningMap = new Map<string, string>();
  // Cap the enqueue attempt — if Redis is unreachable BullMQ would otherwise
  // block the response indefinitely. On timeout, fall back to inline.
  const enqueueWithTimeout = async (): Promise<{ enqueued: boolean }> => {
    const enqueueP = queue.enqueue("schedule.suggest-caregivers", {
      agentRunId: runId,
    });
    const timeoutP = new Promise<{ enqueued: false }>((resolve) =>
      setTimeout(() => resolve({ enqueued: false }), 1500),
    );
    return (await Promise.race([enqueueP, timeoutP])) as { enqueued: boolean };
  };
  const enq = await enqueueWithTimeout();
  if (!enq.enqueued) {
    try {
      const out = await runScheduleOptimizerJob(runId);
      for (const r of out.reasoning) reasoningMap.set(r.caregiverId, r.text);
    } catch (err) {
      logger.warn({ err, runId }, "inline schedule-optimizer fallback failed");
      await failAgentRun(runId, err).catch(() => undefined);
    }
  }

  const fallbackReason = (s: Scored): string => {
    const bits: string[] = [];
    if (s.factors.languageMatches.length)
      bits.push(`shares ${s.factors.languageMatches.join("/")} with client`);
    if (s.factors.driveMinutes != null)
      bits.push(`${s.factors.driveMinutes} min drive`);
    if (s.factors.priorVisitsWithClient > 0)
      bits.push(
        `${s.factors.priorVisitsWithClient} prior visits with this client`,
      );
    if (s.factors.skillMatches.length)
      bits.push(`skills match: ${s.factors.skillMatches.slice(0, 2).join(", ")}`);
    return bits.length
      ? `${s.caregiverName} — ${bits.join("; ")}.`
      : `${s.caregiverName} — composite score ${s.score}/100.`;
  };

  res.json({
    agentRunId: runId,
    asyncReasoning: enq.enqueued,
    suggestions: ranked.map((r, i) => ({
      caregiverId: r.caregiverId,
      caregiverName: r.caregiverName,
      score: r.score,
      rank: i + 1,
      factors: r.factors,
      reasoning:
        i < 3
          ? (reasoningMap.get(r.caregiverId) ?? fallbackReason(r))
          : null,
      blockingConflicts: r.conflicts.filter((c) => c.severity === "BLOCK"),
    })),
  });
});

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
  const [conflicts, otImpact] = await Promise.all([
    validateSchedule({
      caregiverId: parsed.data.caregiverId,
      clientId: parsed.data.clientId,
      startTime: start,
      endTime: end,
      authorizationId: parsed.data.authorizationId ?? null,
    }),
    projectOtImpact({
      caregiverId: parsed.data.caregiverId,
      startTime: start,
      endTime: end,
    }),
  ]);
  const otConflict = otImpactToConflict(otImpact);
  if (otConflict) conflicts.push(otConflict);
  if (isBlocked(conflicts)) {
    res.status(409).json({ schedule: null, conflicts, blocked: true });
    return;
  }
  const id = newId("sch");
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
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
  res
    .status(201)
    .json({ schedule: formatted, conflicts, blocked: false });
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
  const [existing] = await db
    .select()
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        eq(schedulesTable.id, params.data.id),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  const newCaregiverId = parsed.data.caregiverId ?? existing.caregiverId;
  const newClientId = existing.clientId;
  const newStart = parsed.data.startTime ?? existing.startTime;
  const newEnd = parsed.data.endTime ?? existing.endTime;
  if (newEnd <= newStart) {
    res.status(400).json({ error: "endTime must be after startTime" });
    return;
  }
  const [conflicts, otImpact] = await Promise.all([
    validateSchedule({
      caregiverId: newCaregiverId,
      clientId: newClientId,
      startTime: newStart,
      endTime: newEnd,
      excludeScheduleId: existing.id,
      authorizationId: existing.authorizationId,
    }),
    projectOtImpact({
      caregiverId: newCaregiverId,
      startTime: newStart,
      endTime: newEnd,
      excludeScheduleId: existing.id,
    }),
  ]);
  const otConflict = otImpactToConflict(otImpact);
  if (otConflict) conflicts.push(otConflict);
  if (isBlocked(conflicts)) {
    res.status(409).json({ schedule: null, conflicts, blocked: true });
    return;
  }
  const update: Record<string, unknown> = { ...parsed.data };
  update.scheduledMinutes = Math.round(
    (newEnd.getTime() - newStart.getTime()) / 60000,
  );
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
    beforeState: existing,
    afterState: row,
  });
  res.json({ schedule: formatted, conflicts, blocked: false });
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
