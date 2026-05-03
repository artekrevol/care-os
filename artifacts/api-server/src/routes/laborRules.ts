import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, laborRuleSetsTable } from "@workspace/db";
import {
  ListLaborRulesResponse,
  GetActiveLaborRuleResponse,
  SetActiveLaborRuleBody,
  SetActiveLaborRuleResponse,
} from "@workspace/api-zod";
import { AGENCY_ID } from "../lib/agency";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/labor-rules", async (_req, res): Promise<void> => {
  const rules = await db
    .select()
    .from(laborRuleSetsTable)
    .where(eq(laborRuleSetsTable.agencyId, AGENCY_ID))
    .orderBy(laborRuleSetsTable.state);
  res.json(ListLaborRulesResponse.parse(rules));
});

router.get("/labor-rules/active", async (_req, res): Promise<void> => {
  const [rule] = await db
    .select()
    .from(laborRuleSetsTable)
    .where(
      and(
        eq(laborRuleSetsTable.agencyId, AGENCY_ID),
        eq(laborRuleSetsTable.isActive, true),
      ),
    );
  if (!rule) {
    res.status(404).json({ error: "No active rule set" });
    return;
  }
  res.json(GetActiveLaborRuleResponse.parse(rule));
});

router.post("/labor-rules/active", async (req, res): Promise<void> => {
  const parsed = SetActiveLaborRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [rule] = await db
    .select()
    .from(laborRuleSetsTable)
    .where(
      and(
        eq(laborRuleSetsTable.agencyId, AGENCY_ID),
        eq(laborRuleSetsTable.id, parsed.data.ruleId),
      ),
    );
  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  await db
    .update(laborRuleSetsTable)
    .set({ isActive: false })
    .where(eq(laborRuleSetsTable.agencyId, AGENCY_ID));
  const [activated] = await db
    .update(laborRuleSetsTable)
    .set({ isActive: true })
    .where(eq(laborRuleSetsTable.id, parsed.data.ruleId))
    .returning();
  await recordAudit({
    action: "SET_ACTIVE_LABOR_RULE",
    entityType: "LaborRuleSet",
    entityId: activated.id,
    summary: `Active labor rule set to ${activated.name} (${activated.state})`,
    afterState: activated,
  });
  res.json(SetActiveLaborRuleResponse.parse(activated));
});

export default router;
