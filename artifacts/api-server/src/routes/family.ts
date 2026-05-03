import { Router, type IRouter } from "express";
import { and, eq, desc, gte, sql } from "drizzle-orm";
import {
  db,
  familyUsersTable,
  clientsTable,
  visitsTable,
  caregiversTable,
  visitNotesTable,
  visitIncidentsTable,
  schedulesTable,
} from "@workspace/db";
import {
  ListFamilyUsersQueryParams,
  ListFamilyUsersResponse,
  InviteFamilyUserBody,
  GetFamilyMeQueryParams,
  AcceptFamilyInviteBody,
  GetFamilyClientSummaryParams,
  GetFamilyClientSummaryResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { assertFamilyClientAccess } from "../lib/familyAuth";

const router: IRouter = Router();

function formatFamily(f: typeof familyUsersTable.$inferSelect) {
  return {
    id: f.id,
    clientId: f.clientId,
    email: f.email,
    phone: f.phone,
    firstName: f.firstName,
    lastName: f.lastName,
    relationship: f.relationship,
    accessLevel: f.accessLevel as "VIEWER" | "COMMENTER" | "MANAGER",
    invitedAt: f.invitedAt,
    acceptedAt: f.acceptedAt,
    isActive: f.isActive,
    createdAt: f.createdAt,
  };
}

router.get("/family-users", async (req, res): Promise<void> => {
  const parsed = ListFamilyUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(familyUsersTable.agencyId, AGENCY_ID)];
  if (parsed.data.clientId)
    conds.push(eq(familyUsersTable.clientId, parsed.data.clientId));
  const rows = await db
    .select()
    .from(familyUsersTable)
    .where(and(...conds))
    .orderBy(desc(familyUsersTable.createdAt));
  res.json(ListFamilyUsersResponse.parse(rows.map(formatFamily)));
});

router.post("/family-users", async (req, res): Promise<void> => {
  const parsed = InviteFamilyUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = newId("fam");
  const inviteToken = newId("ftok");
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + 14);
  const [row] = await db
    .insert(familyUsersTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      clientId: parsed.data.clientId,
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      relationship: parsed.data.relationship,
      accessLevel: parsed.data.accessLevel ?? "VIEWER",
      invitedAt: new Date(),
      invitedBy: "user_admin",
      isActive: true,
      inviteToken,
      inviteTokenExpiresAt: expires,
    })
    .returning();
  await recordAudit({
    action: "INVITE_FAMILY",
    entityType: "FamilyUser",
    entityId: id,
    summary: `Invited ${row.firstName} ${row.lastName} (${row.relationship}) to family portal`,
    afterState: row,
  });
  res.status(201).json(formatFamily(row));
});

router.get("/family/me", async (req, res): Promise<void> => {
  const parsed = GetFamilyMeQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(familyUsersTable)
    .where(
      and(
        eq(familyUsersTable.agencyId, AGENCY_ID),
        sql`lower(${familyUsersTable.email}) = ${email}`,
        eq(familyUsersTable.isActive, true),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "No family account found for that email" });
    return;
  }
  res.json(formatFamily(row));
});

router.post("/family/me/accept", async (req, res): Promise<void> => {
  const parsed = AcceptFamilyInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(familyUsersTable)
    .where(
      and(
        eq(familyUsersTable.agencyId, AGENCY_ID),
        eq(familyUsersTable.inviteToken, parsed.data.token),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Invite token not found" });
    return;
  }
  if (
    row.inviteTokenExpiresAt &&
    row.inviteTokenExpiresAt.getTime() < Date.now()
  ) {
    res.status(410).json({ error: "Invite has expired" });
    return;
  }
  const [updated] = await db
    .update(familyUsersTable)
    .set({
      acceptedAt: new Date(),
      isActive: true,
      inviteToken: null,
      inviteTokenExpiresAt: null,
    })
    .where(eq(familyUsersTable.id, row.id))
    .returning();
  await recordAudit({
    action: "ACCEPT_FAMILY_INVITE",
    entityType: "FamilyUser",
    entityId: updated.id,
    summary: `${updated.firstName} ${updated.lastName} accepted family portal invite`,
  });
  res.json(formatFamily(updated));
});

router.get(
  "/family/clients/:id/summary",
  async (req, res): Promise<void> => {
    const params = GetFamilyClientSummaryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const clientId = params.data.id;
    if (!(await assertFamilyClientAccess(req, res, clientId))) return;
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(
        and(
          eq(clientsTable.agencyId, AGENCY_ID),
          eq(clientsTable.id, clientId),
        ),
      );
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    const visitRows = await db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.agencyId, AGENCY_ID),
          eq(visitsTable.clientId, clientId),
          gte(visitsTable.clockInTime, since),
        ),
      )
      .orderBy(desc(visitsTable.clockInTime))
      .limit(10);
    const recentVisits = await Promise.all(
      visitRows.map(async (v) => {
        const [cg] = await db
          .select()
          .from(caregiversTable)
          .where(eq(caregiversTable.id, v.caregiverId));
        const notes = await db
          .select()
          .from(visitNotesTable)
          .where(
            and(
              eq(visitNotesTable.agencyId, AGENCY_ID),
              eq(visitNotesTable.visitId, v.id),
            ),
          )
          .orderBy(desc(visitNotesTable.createdAt));
        const incidents = await db
          .select()
          .from(visitIncidentsTable)
          .where(
            and(
              eq(visitIncidentsTable.agencyId, AGENCY_ID),
              eq(visitIncidentsTable.visitId, v.id),
            ),
          )
          .orderBy(desc(visitIncidentsTable.createdAt));
        return {
          id: v.id,
          clockInTime: v.clockInTime,
          clockOutTime: v.clockOutTime,
          durationMinutes: v.durationMinutes,
          caregiverName: cg ? `${cg.firstName} ${cg.lastName}` : "Unknown",
          verificationStatus: v.verificationStatus,
          tasksCompleted: v.tasksCompleted ?? [],
          caregiverNotes: v.caregiverNotes,
          notes: notes.map((n) => ({
            id: n.id,
            visitId: n.visitId,
            authorId: n.authorId,
            authorRole: n.authorRole,
            body: n.body,
            voiceClipUrl: n.voiceClipUrl,
            aiSummary: n.aiSummary,
            createdAt: n.createdAt,
          })),
          incidents: incidents.map((i) => ({
            id: i.id,
            visitId: i.visitId,
            reportedBy: i.reportedBy,
            severity: i.severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
            category: i.category,
            description: i.description,
            photoUrls: i.photoUrls ?? [],
            resolvedAt: i.resolvedAt,
            createdAt: i.createdAt,
          })),
        };
      }),
    );
    const openIncidentCount = recentVisits.reduce(
      (acc, v) => acc + v.incidents.filter((i) => !i.resolvedAt).length,
      0,
    );
    const upcoming = await db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.agencyId, AGENCY_ID),
          eq(schedulesTable.clientId, clientId),
          gte(schedulesTable.startTime, new Date()),
        ),
      )
      .orderBy(schedulesTable.startTime)
      .limit(1);
    res.json(
      GetFamilyClientSummaryResponse.parse({
        clientId: client.id,
        clientName: `${client.firstName} ${client.lastName}`,
        nextScheduledVisit: upcoming[0]?.startTime ?? null,
        recentVisits,
        openIncidentCount,
      }),
    );
  },
);

export default router;
