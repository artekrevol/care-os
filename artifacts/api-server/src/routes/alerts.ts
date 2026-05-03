import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, complianceAlertsTable } from "@workspace/db";
import {
  ListComplianceAlertsQueryParams,
  ListComplianceAlertsResponse,
  AcknowledgeAlertParams,
  AcknowledgeAlertResponse,
  ResolveAlertParams,
  ResolveAlertResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/alerts", async (req, res): Promise<void> => {
  const parsed = ListComplianceAlertsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(complianceAlertsTable.agencyId, AGENCY_ID)];
  if (parsed.data.status)
    conds.push(eq(complianceAlertsTable.status, parsed.data.status));
  const rows = await db
    .select()
    .from(complianceAlertsTable)
    .where(and(...conds))
    .orderBy(desc(complianceAlertsTable.createdAt));
  res.json(ListComplianceAlertsResponse.parse(rows));
});

router.post("/alerts/:id/acknowledge", async (req, res): Promise<void> => {
  const params = AcknowledgeAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .update(complianceAlertsTable)
    .set({ status: "ACKNOWLEDGED" })
    .where(
      and(
        eq(complianceAlertsTable.agencyId, AGENCY_ID),
        eq(complianceAlertsTable.id, params.data.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  await recordAudit({
    action: "ACK_ALERT",
    entityType: "ComplianceAlert",
    entityId: row.id,
    summary: `Acknowledged alert · ${row.title}`,
  });
  res.json(AcknowledgeAlertResponse.parse(row));
});

router.post("/alerts/:id/resolve", async (req, res): Promise<void> => {
  const params = ResolveAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .update(complianceAlertsTable)
    .set({ status: "RESOLVED" })
    .where(
      and(
        eq(complianceAlertsTable.agencyId, AGENCY_ID),
        eq(complianceAlertsTable.id, params.data.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  await recordAudit({
    action: "RESOLVE_ALERT",
    entityType: "ComplianceAlert",
    entityId: row.id,
    summary: `Resolved alert · ${row.title}`,
  });
  res.json(ResolveAlertResponse.parse(row));
});

export default router;
