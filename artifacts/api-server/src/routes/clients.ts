import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql, desc } from "drizzle-orm";
import {
  db,
  clientsTable,
  authorizationsTable,
} from "@workspace/db";
import {
  ListClientsQueryParams,
  ListClientsResponse,
  CreateClientBody,
  GetClientParams,
  GetClientResponse,
  UpdateClientParams,
  UpdateClientBody,
  UpdateClientResponse,
  ListClientAuthorizationsParams,
  ListClientAuthorizationsResponse,
  CreateClientAuthorizationParams,
  CreateClientAuthorizationBody,
  ListExpiringAuthorizationsResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/audit";
import { authStatus, daysUntil } from "../lib/derivedStatus";

const router: IRouter = Router();

function clientName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`;
}

function formatAuth(
  a: typeof authorizationsTable.$inferSelect,
  cName: string,
) {
  const total = Number(a.approvedHoursTotal);
  const used = Number(a.hoursUsed);
  const remaining = Math.max(0, total - used);
  const days = daysUntil(a.expirationDate);
  return {
    id: a.id,
    clientId: a.clientId,
    clientName: cName,
    payer: a.payer,
    authNumber: a.authNumber,
    issuedDate: a.issuedDate,
    expirationDate: a.expirationDate,
    approvedHoursPerWeek: Number(a.approvedHoursPerWeek),
    approvedHoursTotal: total,
    hoursUsed: used,
    hoursRemaining: remaining,
    scopeOfCare: a.scopeOfCare,
    status: authStatus({
      hoursUsed: used,
      hoursTotal: total,
      expirationDate: a.expirationDate,
    }),
    daysUntilExpiration: days ?? 0,
  };
}

router.get("/clients", async (req, res): Promise<void> => {
  const parsed = ListClientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(clientsTable.agencyId, AGENCY_ID)];
  if (parsed.data.status) conds.push(eq(clientsTable.status, parsed.data.status));
  if (parsed.data.search) {
    const s = `%${parsed.data.search}%`;
    conds.push(
      or(
        ilike(clientsTable.firstName, s),
        ilike(clientsTable.lastName, s),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(clientsTable)
    .where(and(...conds))
    .orderBy(clientsTable.lastName);
  res.json(ListClientsResponse.parse(rows));
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = newId("clt");
  const dob = parsed.data.dob.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const [row] = await db
    .insert(clientsTable)
    .values({
      id,
      agencyId: AGENCY_ID,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      dob,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      addressLine1: parsed.data.addressLine1 ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      postalCode: parsed.data.postalCode ?? null,
      primaryPayer: parsed.data.primaryPayer,
      status: "ACTIVE",
      intakeDate: today,
      languages: parsed.data.languages ?? [],
      carePreferences: parsed.data.carePreferences ?? null,
      allergies: parsed.data.allergies ?? null,
      emergencyContactName: parsed.data.emergencyContactName ?? null,
      emergencyContactPhone: parsed.data.emergencyContactPhone ?? null,
    })
    .returning();
  await recordAudit({
    action: "CREATE_CLIENT",
    entityType: "Client",
    entityId: id,
    summary: `Intake created for ${row.firstName} ${row.lastName}`,
    afterState: row,
  });
  res.status(201).json(
    GetClientResponse.parse({
      ...row,
      authorizations: [],
    }),
  );
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
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
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const auths = await db
    .select()
    .from(authorizationsTable)
    .where(
      and(
        eq(authorizationsTable.agencyId, AGENCY_ID),
        eq(authorizationsTable.clientId, client.id),
      ),
    );
  res.json(
    GetClientResponse.parse({
      ...client,
      authorizations: auths.map((a) => formatAuth(a, clientName(client))),
    }),
  );
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const update: Record<string, unknown> = { ...parsed.data };
  const [row] = await db
    .update(clientsTable)
    .set(update)
    .where(
      and(
        eq(clientsTable.agencyId, AGENCY_ID),
        eq(clientsTable.id, params.data.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  await recordAudit({
    action: "UPDATE_CLIENT",
    entityType: "Client",
    entityId: row.id,
    summary: `Updated client ${clientName(row)}`,
    afterState: row,
  });
  res.json(UpdateClientResponse.parse(row));
});

router.get("/clients/:id/authorizations", async (req, res): Promise<void> => {
  const params = ListClientAuthorizationsParams.safeParse(req.params);
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
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const auths = await db
    .select()
    .from(authorizationsTable)
    .where(
      and(
        eq(authorizationsTable.agencyId, AGENCY_ID),
        eq(authorizationsTable.clientId, params.data.id),
      ),
    );
  res.json(
    ListClientAuthorizationsResponse.parse(
      auths.map((a) => formatAuth(a, clientName(client))),
    ),
  );
});

router.post(
  "/clients/:id/authorizations",
  async (req, res): Promise<void> => {
    const params = CreateClientAuthorizationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateClientAuthorizationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
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
    const id = newId("auth");
    const issued =
      parsed.data.issuedDate instanceof Date
        ? parsed.data.issuedDate.toISOString().slice(0, 10)
        : parsed.data.issuedDate;
    const exp =
      parsed.data.expirationDate instanceof Date
        ? parsed.data.expirationDate.toISOString().slice(0, 10)
        : parsed.data.expirationDate;
    const [row] = await db
      .insert(authorizationsTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        clientId: params.data.id,
        payer: parsed.data.payer,
        authNumber: parsed.data.authNumber,
        issuedDate: issued,
        expirationDate: exp,
        approvedHoursPerWeek: String(parsed.data.approvedHoursPerWeek),
        approvedHoursTotal: String(parsed.data.approvedHoursTotal),
        hoursUsed: "0",
        scopeOfCare: parsed.data.scopeOfCare ?? [],
      })
      .returning();
    await recordAudit({
      action: "CREATE_AUTH",
      entityType: "Authorization",
      entityId: id,
      summary: `New authorization ${row.authNumber} for ${clientName(client)}`,
      afterState: row,
    });
    res.status(201).json(formatAuth(row, clientName(client)));
  },
);

router.get("/authorizations/expiring", async (_req, res): Promise<void> => {
  const auths = await db
    .select({
      auth: authorizationsTable,
      client: clientsTable,
    })
    .from(authorizationsTable)
    .innerJoin(
      clientsTable,
      eq(authorizationsTable.clientId, clientsTable.id),
    )
    .where(eq(authorizationsTable.agencyId, AGENCY_ID))
    .orderBy(authorizationsTable.expirationDate);
  const formatted = auths
    .map(({ auth, client }) => formatAuth(auth, clientName(client)))
    .filter((a) => a.status === "EXPIRING_SOON" || a.status === "EXPIRED");
  res.json(ListExpiringAuthorizationsResponse.parse(formatted));
});

export default router;
