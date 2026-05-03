import { and, eq, gte, lte } from "drizzle-orm";
import {
  db,
  caregiversTable,
  clientsTable,
  schedulesTable,
  visitsTable,
  compatibilityScoresTable,
  type Caregiver,
  type Client,
} from "@workspace/db";
import { maps } from "@workspace/services";
import { AGENCY_ID } from "./agency";
import { newId } from "./ids";
import { pickHomeLatLng } from "./geo";
import {
  endOfIsoWeek,
  startOfIsoWeek,
} from "./scheduleProjection";

const W = {
  skill: 40,
  language: 15,
  drive: 20,
  continuity: 10,
  availability: 10,
  otSafe: 5,
} as const;

export type CompatibilityFactors = {
  skillScore: number;
  languageScore: number;
  driveScore: number;
  continuityScore: number;
  availabilityScore: number;
  otSafeScore: number;
  skillMatches: string[];
  languageMatches: string[];
  driveMinutes: number | null;
  priorVisitsWithClient: number;
  weeklyHeadroomMinutes: number;
};

export type Scored = {
  caregiverId: string;
  caregiverName: string;
  score: number;
  factors: CompatibilityFactors;
};

export async function scoreCaregiver(opts: {
  caregiver: Caregiver;
  client: Client;
  startTime: Date;
  endTime: Date;
  excludeScheduleId?: string;
}): Promise<Scored> {
  const { caregiver, client, startTime, endTime, excludeScheduleId } = opts;
  const cgSkills = (caregiver.skills ?? []).map((s) => s.toLowerCase());
  const clientNeeds = [
    ...(client.languages ?? []),
    client.allergies ?? "",
    client.carePreferences ?? "",
    client.fallRisk ?? "",
    client.cognitiveStatus ?? "",
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());

  // Skill: prefer overlapping caregiver skills with implied client needs.
  // Reuse caregiver compatibilityTags as direct match boosters.
  const tagBoost = (caregiver.compatibilityTags ?? []).map((t) =>
    t.toLowerCase(),
  );
  const skillTokens = new Set([...cgSkills, ...tagBoost]);
  const skillMatches: string[] = [];
  for (const need of clientNeeds) {
    for (const sk of skillTokens) {
      if (need.includes(sk) || sk.includes(need)) {
        if (!skillMatches.includes(sk)) skillMatches.push(sk);
      }
    }
  }
  const skillScore =
    Math.min(1, skillMatches.length / 3) * W.skill ||
    (skillTokens.size > 0 ? W.skill * 0.3 : 0);

  // Language: at least one shared language → full points
  const cgLangs = (caregiver.languages ?? []).map((l) => l.toLowerCase());
  const ctLangs = (client.languages ?? []).map((l) => l.toLowerCase());
  const languageMatches = cgLangs.filter((l) => ctLangs.includes(l));
  const languageScore =
    languageMatches.length > 0
      ? W.language
      : ctLangs.length === 0
        ? W.language * 0.5
        : 0;

  // Drive: full points at <=20min, scaled to 0 at >=60min.
  const cgLatLng = pickHomeLatLng({
    homeLat: caregiver.homeLat,
    homeLng: caregiver.homeLng,
    city: caregiver.addressCity,
  });
  const ctLatLng = pickHomeLatLng({
    homeLat: client.homeLat,
    homeLng: client.homeLng,
    city: client.city,
  });
  let driveMinutes: number | null = null;
  if (cgLatLng && ctLatLng) {
    const dt = await maps.getDriveTime(
      cgLatLng,
      ctLatLng,
      startTime.getUTCHours(),
    );
    driveMinutes = Math.round(dt.durationSeconds / 60);
  }
  const driveScore =
    driveMinutes == null
      ? W.drive * 0.5
      : driveMinutes <= 20
        ? W.drive
        : driveMinutes >= 60
          ? 0
          : W.drive * (1 - (driveMinutes - 20) / 40);

  // Continuity: prior visits with this client over last 60 days
  const cutoff = new Date(startTime);
  cutoff.setUTCDate(cutoff.getUTCDate() - 60);
  const priorVisits = await db
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, AGENCY_ID),
        eq(visitsTable.caregiverId, caregiver.id),
        eq(visitsTable.clientId, client.id),
        gte(visitsTable.clockInTime, cutoff),
      ),
    );
  const priorCount = priorVisits.length;
  const continuityScore =
    Math.min(1, priorCount / 5) * W.continuity ||
    (priorCount > 0 ? W.continuity * 0.4 : 0);

  // Availability: caregiver has no overlap on same day
  const dayStart = new Date(startTime);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const sameDay = await db
    .select()
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        eq(schedulesTable.caregiverId, caregiver.id),
        gte(schedulesTable.startTime, dayStart),
        lte(schedulesTable.startTime, dayEnd),
      ),
    );
  const filtered = sameDay.filter((s) => s.id !== excludeScheduleId);
  const overlap = filtered.some(
    (s) => s.startTime < endTime && s.endTime > startTime,
  );
  const availabilityScore = overlap ? 0 : W.availability;

  // OT safety: weekly headroom under 40h after this shift
  const weekStart = startOfIsoWeek(startTime);
  const weekEnd = endOfIsoWeek(startTime);
  const weekShifts = await db
    .select()
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, AGENCY_ID),
        eq(schedulesTable.caregiverId, caregiver.id),
        gte(schedulesTable.startTime, weekStart),
        lte(schedulesTable.startTime, weekEnd),
      ),
    );
  const weekMinutes = weekShifts
    .filter((s) => s.id !== excludeScheduleId)
    .reduce((s, x) => s + x.scheduledMinutes, 0);
  const proposedMin = Math.max(
    0,
    Math.round((endTime.getTime() - startTime.getTime()) / 60000),
  );
  const projected = weekMinutes + proposedMin;
  const headroom = 40 * 60 - projected;
  const otSafeScore =
    headroom >= 0 ? W.otSafe : Math.max(0, W.otSafe + headroom / 60);

  const total =
    skillScore +
    languageScore +
    driveScore +
    continuityScore +
    availabilityScore +
    otSafeScore;

  return {
    caregiverId: caregiver.id,
    caregiverName: `${caregiver.firstName} ${caregiver.lastName}`,
    score: Math.round(total * 10) / 10,
    factors: {
      skillScore: Math.round(skillScore * 10) / 10,
      languageScore: Math.round(languageScore * 10) / 10,
      driveScore: Math.round(driveScore * 10) / 10,
      continuityScore: Math.round(continuityScore * 10) / 10,
      availabilityScore: Math.round(availabilityScore * 10) / 10,
      otSafeScore: Math.round(otSafeScore * 10) / 10,
      skillMatches,
      languageMatches,
      driveMinutes,
      priorVisitsWithClient: priorCount,
      weeklyHeadroomMinutes: headroom,
    },
  };
}

export async function persistCompatibilityScore(opts: {
  caregiverId: string;
  clientId: string;
  score: number;
  factors: CompatibilityFactors;
  agentRunId?: string | null;
}): Promise<void> {
  await db.insert(compatibilityScoresTable).values({
    id: newId("cs"),
    agencyId: AGENCY_ID,
    caregiverId: opts.caregiverId,
    clientId: opts.clientId,
    score: String(opts.score),
    factors: opts.factors,
    computedBy: "schedule-optimizer",
    agentRunId: opts.agentRunId ?? null,
  });
}

export async function loadEligibleCaregivers(): Promise<Caregiver[]> {
  return db
    .select()
    .from(caregiversTable)
    .where(
      and(
        eq(caregiversTable.agencyId, AGENCY_ID),
        eq(caregiversTable.status, "ACTIVE"),
      ),
    );
}

export async function loadClient(clientId: string): Promise<Client | null> {
  const [row] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  return row ?? null;
}
