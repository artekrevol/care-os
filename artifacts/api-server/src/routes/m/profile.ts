import { Router, type IRouter } from "express";
import { and, eq, desc, gte } from "drizzle-orm";
import {
  db,
  caregiversTable,
  caregiverDocumentsTable,
  timeEntriesTable,
  payPeriodsTable,
} from "@workspace/db";
import { AGENCY_ID } from "../../lib/agency";
import { requireCaregiverSession, type MAuthedRequest } from "./middleware";

const router: IRouter = Router();

function docStatus(d: typeof caregiverDocumentsTable.$inferSelect): string {
  if (!d.expirationDate) return "VALID";
  const exp = new Date(d.expirationDate).getTime();
  const now = Date.now();
  if (exp < now) return "EXPIRED";
  if (exp - now < 30 * 24 * 60 * 60 * 1000) return "EXPIRING";
  return "VALID";
}

router.get(
  "/m/profile",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const [cg] = await db
      .select()
      .from(caregiversTable)
      .where(
        and(
          eq(caregiversTable.agencyId, AGENCY_ID),
          eq(caregiversTable.id, caregiverId),
        ),
      )
      .limit(1);
    if (!cg) {
      res.status(404).json({ error: "caregiver not found" });
      return;
    }
    const docs = await db
      .select()
      .from(caregiverDocumentsTable)
      .where(
        and(
          eq(caregiverDocumentsTable.agencyId, AGENCY_ID),
          eq(caregiverDocumentsTable.caregiverId, caregiverId),
        ),
      );
    res.json({
      caregiver: {
        id: cg.id,
        firstName: cg.firstName,
        lastName: cg.lastName,
        email: cg.email,
        phone: cg.phone,
        addressCity: cg.addressCity,
        addressState: cg.addressState,
        hireDate: cg.hireDate,
        employmentType: cg.employmentType,
        languages: cg.languages,
        skills: cg.skills,
        certifications: cg.certifications,
        payRate: Number(cg.payRate),
        userId: cg.userId,
      },
      credentials: docs.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        classifiedType: d.classifiedType,
        issuedDate: d.issuedDate,
        expirationDate: d.expirationDate,
        fileUrl: d.fileUrl,
        originalFilename: d.originalFilename,
        classificationStatus: d.classificationStatus,
        needsReview: d.needsReview,
        status: docStatus(d),
      })),
    });
  },
);

router.get(
  "/m/pay-summary",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const caregiverId = (req as MAuthedRequest).caregiverId;
    const sinceDate = new Date();
    sinceDate.setMonth(sinceDate.getMonth() - 6);
    const since = sinceDate.toISOString().slice(0, 10);
    const entries = await db
      .select()
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.agencyId, AGENCY_ID),
          eq(timeEntriesTable.caregiverId, caregiverId),
          gte(timeEntriesTable.workDate, since),
        ),
      )
      .orderBy(desc(timeEntriesTable.workDate));

    const periodIds = Array.from(new Set(entries.map((e) => e.payPeriodId)));
    const periods = periodIds.length
      ? await db
          .select()
          .from(payPeriodsTable)
          .where(eq(payPeriodsTable.agencyId, AGENCY_ID))
      : [];
    const periodMap = new Map(periods.map((p) => [p.id, p]));

    const byPeriod = new Map<
      string,
      {
        payPeriodId: string;
        startDate: string;
        endDate: string;
        status: string;
        regularMinutes: number;
        overtimeMinutes: number;
        regularPay: number;
        overtimePay: number;
        doubleTimePay: number;
        travelPay: number;
        totalPay: number;
        entryCount: number;
      }
    >();
    for (const e of entries) {
      const p = periodMap.get(e.payPeriodId);
      if (!p) continue;
      const cur = byPeriod.get(e.payPeriodId) ?? {
        payPeriodId: p.id,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status,
        regularMinutes: 0,
        overtimeMinutes: 0,
        regularPay: 0,
        overtimePay: 0,
        doubleTimePay: 0,
        travelPay: 0,
        totalPay: 0,
        entryCount: 0,
      };
      cur.regularMinutes += e.regularMinutes;
      cur.overtimeMinutes += e.overtimeMinutes;
      cur.regularPay += Number(e.regularPay);
      cur.overtimePay += Number(e.overtimePay);
      cur.doubleTimePay += Number(e.doubleTimePay);
      cur.travelPay += Number(e.travelPay);
      cur.totalPay +=
        Number(e.regularPay) +
        Number(e.overtimePay) +
        Number(e.doubleTimePay) +
        Number(e.travelPay);
      cur.entryCount += 1;
      byPeriod.set(e.payPeriodId, cur);
    }
    const rows = Array.from(byPeriod.values()).sort((a, b) =>
      b.startDate.localeCompare(a.startDate),
    );
    res.json({ periods: rows });
  },
);

export default router;
