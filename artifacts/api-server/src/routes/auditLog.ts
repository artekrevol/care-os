import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, auditLogTable } from "@workspace/db";
import {
  ListAuditLogQueryParams,
  ListAuditLogResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";

const router: IRouter = Router();

router.get("/audit-log", async (req, res): Promise<void> => {
  const parsed = ListAuditLogQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conds = [eq(auditLogTable.agencyId, AGENCY_ID)];
  if (parsed.data.entityType)
    conds.push(eq(auditLogTable.entityType, parsed.data.entityType));
  if (parsed.data.entityId)
    conds.push(eq(auditLogTable.entityId, parsed.data.entityId));
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(and(...conds))
    .orderBy(desc(auditLogTable.timestamp))
    .limit(500);
  res.json(ListAuditLogResponse.parse(rows));
});

export default router;
