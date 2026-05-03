import { and, eq, gte, lte, asc, desc, sql } from "drizzle-orm";
import {
  db,
  visitsTable,
  schedulesTable,
  caregiversTable,
  clientsTable,
  authorizationsTable,
  caregiverDocumentsTable,
  payPeriodsTable,
  laborRuleSetsTable,
  auditLogTable,
  type Caregiver,
  type Client,
  type AuthorizationRow,
  type CaregiverDocumentRow,
  type Visit,
} from "@workspace/db";
import { applyRule, type RawWorkDay } from "../labor/index";

export interface ReportFilters {
  agencyId: string;
  from?: Date;
  to?: Date;
  caregiverId?: string;
  clientId?: string;
  payer?: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

async function resolveDateRange(
  filters: ReportFilters,
): Promise<{ from: Date; to: Date }> {
  if (filters.from && filters.to) {
    return { from: filters.from, to: filters.to };
  }
  // Default to current open pay period; fallback to current week.
  const [openPeriod] = await db
    .select()
    .from(payPeriodsTable)
    .where(
      and(
        eq(payPeriodsTable.agencyId, filters.agencyId),
        eq(payPeriodsTable.status, "OPEN"),
      ),
    )
    .orderBy(desc(payPeriodsTable.startDate))
    .limit(1);
  if (openPeriod) {
    return {
      from: filters.from ?? new Date(openPeriod.startDate + "T00:00:00Z"),
      to: filters.to ?? new Date(openPeriod.endDate + "T23:59:59Z"),
    };
  }
  const now = new Date();
  const start = new Date(now);
  const day = start.getUTCDay();
  const offset = (day + 6) % 7;
  start.setUTCDate(start.getUTCDate() - offset);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { from: filters.from ?? start, to: filters.to ?? end };
}

// =====================================================================
// 1. Caregiver Utilization
// =====================================================================
export interface CaregiverUtilizationRow {
  caregiverId: string;
  caregiverName: string;
  scheduledHours: number;
  deliveredHours: number;
  utilizationPct: number;
  overtimeHours: number;
  overtimePct: number;
  missedVisits: number;
  visitsCompleted: number;
}

export interface CaregiverUtilizationReport {
  rangeStart: string;
  rangeEnd: string;
  rows: CaregiverUtilizationRow[];
  totals: {
    scheduledHours: number;
    deliveredHours: number;
    overtimeHours: number;
    missedVisits: number;
  };
}

export async function caregiverUtilizationReport(
  filters: ReportFilters,
): Promise<CaregiverUtilizationReport> {
  const { from, to } = await resolveDateRange(filters);

  const cgs = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.agencyId, filters.agencyId));

  const schedules = await db
    .select()
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.agencyId, filters.agencyId),
        gte(schedulesTable.startTime, from),
        lte(schedulesTable.startTime, to),
      ),
    );

  const visits = await db
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, filters.agencyId),
        gte(visitsTable.clockInTime, from),
        lte(visitsTable.clockInTime, to),
      ),
    );

  const [activeRule] = await db
    .select()
    .from(laborRuleSetsTable)
    .where(
      and(
        eq(laborRuleSetsTable.agencyId, filters.agencyId),
        eq(laborRuleSetsTable.isActive, true),
      ),
    );

  const otByCg = new Map<string, number>();
  if (activeRule) {
    const rows: RawWorkDay[] = visits
      .filter(
        (v) => v.verificationStatus === "VERIFIED" && v.durationMinutes != null,
      )
      .map((v) => ({
        caregiverId: v.caregiverId,
        visitId: v.id,
        workDate: (v.clockInTime ?? v.clockOutTime!).toISOString().slice(0, 10),
        minutes: v.durationMinutes ?? 0,
        payRate: 0,
      }));
    const computed = applyRule(activeRule, rows);
    for (const e of computed) {
      otByCg.set(
        e.caregiverId,
        (otByCg.get(e.caregiverId) ?? 0) + e.overtimeMinutes + e.doubleTimeMinutes,
      );
    }
  }

  const filteredCgs = filters.caregiverId
    ? cgs.filter((c) => c.id === filters.caregiverId)
    : cgs;

  const rows: CaregiverUtilizationRow[] = filteredCgs.map((c) => {
    const scheduled = schedules.filter((s) => s.caregiverId === c.id);
    const cgVisits = visits.filter((v) => v.caregiverId === c.id);
    const scheduledMin = scheduled.reduce((s, x) => s + x.scheduledMinutes, 0);
    const deliveredMin = cgVisits
      .filter((v) => v.verificationStatus === "VERIFIED")
      .reduce((s, v) => s + (v.durationMinutes ?? 0), 0);
    const missed = scheduled.filter((s) => s.status === "MISSED").length;
    const completed = cgVisits.filter(
      (v) => v.verificationStatus === "VERIFIED",
    ).length;
    const otMin = otByCg.get(c.id) ?? 0;
    const deliveredHours = round1(deliveredMin / 60);
    const scheduledHours = round1(scheduledMin / 60);
    const otHours = round1(otMin / 60);
    return {
      caregiverId: c.id,
      caregiverName: `${c.firstName} ${c.lastName}`,
      scheduledHours,
      deliveredHours,
      utilizationPct:
        scheduledMin === 0
          ? 0
          : Math.round((deliveredMin / scheduledMin) * 1000) / 10,
      overtimeHours: otHours,
      overtimePct:
        deliveredMin === 0 ? 0 : Math.round((otMin / deliveredMin) * 1000) / 10,
      missedVisits: missed,
      visitsCompleted: completed,
    };
  });

  rows.sort((a, b) => b.deliveredHours - a.deliveredHours);

  return {
    rangeStart: from.toISOString().slice(0, 10),
    rangeEnd: to.toISOString().slice(0, 10),
    rows,
    totals: {
      scheduledHours: round1(rows.reduce((s, r) => s + r.scheduledHours, 0)),
      deliveredHours: round1(rows.reduce((s, r) => s + r.deliveredHours, 0)),
      overtimeHours: round1(rows.reduce((s, r) => s + r.overtimeHours, 0)),
      missedVisits: rows.reduce((s, r) => s + r.missedVisits, 0),
    },
  };
}

// =====================================================================
// 2. Client Hours vs. Authorized
// =====================================================================
export interface ClientHoursRow {
  clientId: string;
  clientName: string;
  payer: string;
  authNumber: string;
  approvedHoursTotal: number;
  hoursDelivered: number;
  hoursRemaining: number;
  drawdownPct: number;
  weeklyBurnHours: number;
  expirationDate: string;
  projectedExhaustionDate: string | null;
}

export interface ClientHoursReport {
  rangeStart: string;
  rangeEnd: string;
  rows: ClientHoursRow[];
}

export async function clientHoursReport(
  filters: ReportFilters,
): Promise<ClientHoursReport> {
  const { from, to } = await resolveDateRange(filters);

  const auths = await db
    .select()
    .from(authorizationsTable)
    .where(eq(authorizationsTable.agencyId, filters.agencyId));
  const clients = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.agencyId, filters.agencyId));
  const visits = await db
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, filters.agencyId),
        eq(visitsTable.verificationStatus, "VERIFIED"),
      ),
    );
  const cMap = new Map(clients.map((c) => [c.id, c]));

  const filtered = auths.filter((a) => {
    if (filters.clientId && a.clientId !== filters.clientId) return false;
    if (filters.payer && a.payer !== filters.payer) return false;
    return true;
  });

  // Hours delivered per client across last 4 weeks for burn projection
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);
  const burnByClient = new Map<string, number>();
  for (const v of visits) {
    if (!v.clockInTime) continue;
    if (v.clockInTime < fourWeeksAgo) continue;
    burnByClient.set(
      v.clientId,
      (burnByClient.get(v.clientId) ?? 0) + (v.durationMinutes ?? 0),
    );
  }

  const rows: ClientHoursRow[] = filtered.map((a) => {
    const c = cMap.get(a.clientId);
    const total = Number(a.approvedHoursTotal);
    const used = Number(a.hoursUsed);
    const remaining = Math.max(0, total - used);
    const burnMin = burnByClient.get(a.clientId) ?? 0;
    const weeklyBurn = round1(burnMin / 60 / 4);
    let projected: string | null = null;
    if (weeklyBurn > 0 && remaining > 0) {
      const weeksLeft = remaining / weeklyBurn;
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + Math.round(weeksLeft * 7));
      projected = d.toISOString().slice(0, 10);
    }
    return {
      clientId: a.clientId,
      clientName: c ? `${c.firstName} ${c.lastName}` : "Unknown",
      payer: a.payer,
      authNumber: a.authNumber,
      approvedHoursTotal: total,
      hoursDelivered: round2(used),
      hoursRemaining: round2(remaining),
      drawdownPct: total === 0 ? 0 : Math.round((used / total) * 1000) / 10,
      weeklyBurnHours: weeklyBurn,
      expirationDate: a.expirationDate,
      projectedExhaustionDate: projected,
    };
  });
  rows.sort((a, b) => b.drawdownPct - a.drawdownPct);

  return {
    rangeStart: from.toISOString().slice(0, 10),
    rangeEnd: to.toISOString().slice(0, 10),
    rows,
  };
}

// =====================================================================
// 3. Document Compliance
// =====================================================================
export interface DocumentComplianceRow {
  caregiverId: string;
  caregiverName: string;
  documentType: string;
  expirationDate: string | null;
  daysUntilExpiration: number | null;
  status: "EXPIRED" | "EXPIRING" | "OVERDUE_TRAINING" | "MISSING";
}

export interface DocumentComplianceReport {
  rangeStart: string;
  rangeEnd: string;
  rows: DocumentComplianceRow[];
  totals: { expired: number; expiring: number; overdueTraining: number };
}

export async function documentComplianceReport(
  filters: ReportFilters,
): Promise<DocumentComplianceReport> {
  const { from, to } = await resolveDateRange(filters);
  const cgs = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.agencyId, filters.agencyId));
  const docs = await db
    .select()
    .from(caregiverDocumentsTable)
    .where(eq(caregiverDocumentsTable.agencyId, filters.agencyId));
  const cgMap = new Map(cgs.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + 30);

  const rows: DocumentComplianceRow[] = [];
  for (const d of docs) {
    if (filters.caregiverId && d.caregiverId !== filters.caregiverId) continue;
    if (!d.expirationDate) continue;
    const exp = new Date(d.expirationDate + "T00:00:00Z");
    const days = Math.round(
      (exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );
    let status: DocumentComplianceRow["status"] | null = null;
    if (exp < today) {
      status = d.documentType === "TRAINING" ? "OVERDUE_TRAINING" : "EXPIRED";
    } else if (exp <= horizon) {
      status = "EXPIRING";
    }
    if (!status) continue;
    rows.push({
      caregiverId: d.caregiverId,
      caregiverName: cgMap.get(d.caregiverId) ?? "Unknown",
      documentType: d.documentType,
      expirationDate: d.expirationDate,
      daysUntilExpiration: days,
      status,
    });
  }
  rows.sort(
    (a, b) =>
      (a.daysUntilExpiration ?? 9999) - (b.daysUntilExpiration ?? 9999),
  );

  return {
    rangeStart: from.toISOString().slice(0, 10),
    rangeEnd: to.toISOString().slice(0, 10),
    rows,
    totals: {
      expired: rows.filter((r) => r.status === "EXPIRED").length,
      expiring: rows.filter((r) => r.status === "EXPIRING").length,
      overdueTraining: rows.filter((r) => r.status === "OVERDUE_TRAINING")
        .length,
    },
  };
}

// =====================================================================
// 4. OT Exposure Forecast
// =====================================================================
export interface OvertimeForecastRow {
  caregiverId: string;
  caregiverName: string;
  thisPeriodOvertimeHours: number;
  thisPeriodOvertimeCost: number;
  nextPeriodOvertimeHours: number;
  nextPeriodOvertimeCost: number;
}

export interface OvertimeForecastReport {
  rangeStart: string;
  rangeEnd: string;
  ruleName: string;
  rows: OvertimeForecastRow[];
  totals: {
    thisPeriodOvertimeHours: number;
    thisPeriodOvertimeCost: number;
    nextPeriodOvertimeHours: number;
    nextPeriodOvertimeCost: number;
  };
}

export async function overtimeForecastReport(
  filters: ReportFilters,
): Promise<OvertimeForecastReport> {
  const { from, to } = await resolveDateRange(filters);
  const periodLengthMs = to.getTime() - from.getTime();
  const nextFrom = new Date(to.getTime() + 1);
  const nextTo = new Date(nextFrom.getTime() + periodLengthMs);

  const cgs = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.agencyId, filters.agencyId));
  const cgMap = new Map(cgs.map((c) => [c.id, c]));

  const [activeRule] = await db
    .select()
    .from(laborRuleSetsTable)
    .where(
      and(
        eq(laborRuleSetsTable.agencyId, filters.agencyId),
        eq(laborRuleSetsTable.isActive, true),
      ),
    );

  const fetchSchedules = async (a: Date, b: Date) =>
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.agencyId, filters.agencyId),
          gte(schedulesTable.startTime, a),
          lte(schedulesTable.startTime, b),
        ),
      );
  const thisSch = await fetchSchedules(from, to);
  const nextSch = await fetchSchedules(nextFrom, nextTo);

  const computeFor = (
    sch: typeof thisSch,
  ): Map<string, { ot: number; cost: number }> => {
    const out = new Map<string, { ot: number; cost: number }>();
    if (!activeRule) return out;
    const rows: RawWorkDay[] = sch.map((s) => ({
      caregiverId: s.caregiverId,
      visitId: s.id,
      workDate: s.startTime.toISOString().slice(0, 10),
      minutes: s.scheduledMinutes,
      payRate: Number(cgMap.get(s.caregiverId)?.payRate ?? 0),
    }));
    const computed = applyRule(activeRule, rows);
    for (const e of computed) {
      const t = out.get(e.caregiverId) ?? { ot: 0, cost: 0 };
      t.ot += e.overtimeMinutes + e.doubleTimeMinutes;
      t.cost += e.overtimePay + e.doubleTimePay;
      out.set(e.caregiverId, t);
    }
    return out;
  };

  const thisP = computeFor(thisSch);
  const nextP = computeFor(nextSch);

  const ids = new Set<string>([...thisP.keys(), ...nextP.keys()]);
  const rows: OvertimeForecastRow[] = [];
  for (const id of ids) {
    if (filters.caregiverId && id !== filters.caregiverId) continue;
    const cg = cgMap.get(id);
    const t = thisP.get(id) ?? { ot: 0, cost: 0 };
    const n = nextP.get(id) ?? { ot: 0, cost: 0 };
    rows.push({
      caregiverId: id,
      caregiverName: cg ? `${cg.firstName} ${cg.lastName}` : "Unknown",
      thisPeriodOvertimeHours: round1(t.ot / 60),
      thisPeriodOvertimeCost: round2(t.cost),
      nextPeriodOvertimeHours: round1(n.ot / 60),
      nextPeriodOvertimeCost: round2(n.cost),
    });
  }
  rows.sort(
    (a, b) =>
      b.thisPeriodOvertimeHours +
      b.nextPeriodOvertimeHours -
      (a.thisPeriodOvertimeHours + a.nextPeriodOvertimeHours),
  );

  return {
    rangeStart: from.toISOString().slice(0, 10),
    rangeEnd: to.toISOString().slice(0, 10),
    ruleName: activeRule?.name ?? "No rule selected",
    rows,
    totals: {
      thisPeriodOvertimeHours: round1(
        rows.reduce((s, r) => s + r.thisPeriodOvertimeHours, 0),
      ),
      thisPeriodOvertimeCost: round2(
        rows.reduce((s, r) => s + r.thisPeriodOvertimeCost, 0),
      ),
      nextPeriodOvertimeHours: round1(
        rows.reduce((s, r) => s + r.nextPeriodOvertimeHours, 0),
      ),
      nextPeriodOvertimeCost: round2(
        rows.reduce((s, r) => s + r.nextPeriodOvertimeCost, 0),
      ),
    },
  };
}

// =====================================================================
// 5. Visit Verification
// =====================================================================
export interface VisitVerificationExceptionBucket {
  reason: string;
  count: number;
}

export interface VisitVerificationReport {
  rangeStart: string;
  rangeEnd: string;
  totalVisits: number;
  verifiedCount: number;
  exceptionCount: number;
  pendingCount: number;
  rejectedCount: number;
  verificationRatePct: number;
  averageMinutesToVerify: number | null;
  exceptionTypes: VisitVerificationExceptionBucket[];
  rows: Array<{
    visitId: string;
    caregiverId: string;
    caregiverName: string;
    clientId: string;
    clientName: string;
    workDate: string;
    status: string;
    exceptionReason: string | null;
    minutesToVerify: number | null;
  }>;
}

export async function visitVerificationReport(
  filters: ReportFilters,
): Promise<VisitVerificationReport> {
  const { from, to } = await resolveDateRange(filters);
  const visits = await db
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.agencyId, filters.agencyId),
        gte(visitsTable.clockInTime, from),
        lte(visitsTable.clockInTime, to),
      ),
    )
    .orderBy(asc(visitsTable.clockInTime));
  const cgs = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.agencyId, filters.agencyId));
  const clients = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.agencyId, filters.agencyId));
  const cgMap = new Map(cgs.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
  const clMap = new Map(clients.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));

  const verifyAudits = await db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.agencyId, filters.agencyId),
        eq(auditLogTable.action, "VERIFY_VISIT"),
      ),
    );
  const verifyTimeByVisit = new Map<string, Date>();
  for (const a of verifyAudits) {
    if (!a.entityId) continue;
    const existing = verifyTimeByVisit.get(a.entityId);
    if (!existing || a.timestamp < existing)
      verifyTimeByVisit.set(a.entityId, a.timestamp);
  }

  const filtered = visits.filter((v) => {
    if (filters.caregiverId && v.caregiverId !== filters.caregiverId)
      return false;
    if (filters.clientId && v.clientId !== filters.clientId) return false;
    return true;
  });

  let verified = 0,
    exception = 0,
    pending = 0,
    rejected = 0;
  let verifyDeltaMs = 0,
    verifyDeltaCount = 0;
  const exceptionByReason = new Map<string, number>();
  const rows: VisitVerificationReport["rows"] = [];

  for (const v of filtered) {
    if (v.verificationStatus === "VERIFIED") verified++;
    else if (v.verificationStatus === "EXCEPTION") exception++;
    else if (v.verificationStatus === "PENDING") pending++;
    else if (v.verificationStatus === "REJECTED") rejected++;

    if (v.exceptionReason) {
      exceptionByReason.set(
        v.exceptionReason,
        (exceptionByReason.get(v.exceptionReason) ?? 0) + 1,
      );
    }
    let minutesToVerify: number | null = null;
    const verifyAt = verifyTimeByVisit.get(v.id);
    if (verifyAt && v.clockOutTime) {
      const ms = verifyAt.getTime() - v.clockOutTime.getTime();
      if (ms >= 0) {
        minutesToVerify = Math.round(ms / 60000);
        verifyDeltaMs += ms;
        verifyDeltaCount++;
      }
    }
    rows.push({
      visitId: v.id,
      caregiverId: v.caregiverId,
      caregiverName: cgMap.get(v.caregiverId) ?? "Unknown",
      clientId: v.clientId,
      clientName: clMap.get(v.clientId) ?? "Unknown",
      workDate: (v.clockInTime ?? v.clockOutTime ?? new Date())
        .toISOString()
        .slice(0, 10),
      status: v.verificationStatus,
      exceptionReason: v.exceptionReason,
      minutesToVerify,
    });
  }

  return {
    rangeStart: from.toISOString().slice(0, 10),
    rangeEnd: to.toISOString().slice(0, 10),
    totalVisits: filtered.length,
    verifiedCount: verified,
    exceptionCount: exception,
    pendingCount: pending,
    rejectedCount: rejected,
    verificationRatePct:
      filtered.length === 0
        ? 0
        : Math.round((verified / filtered.length) * 1000) / 10,
    averageMinutesToVerify:
      verifyDeltaCount === 0
        ? null
        : Math.round(verifyDeltaMs / verifyDeltaCount / 60000),
    exceptionTypes: [...exceptionByReason.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    rows,
  };
}

// =====================================================================
// 6. Authorization Pipeline
// =====================================================================
export interface AuthorizationPipelineRow {
  authorizationId: string;
  clientId: string;
  clientName: string;
  payer: string;
  authNumber: string;
  expirationDate: string;
  daysUntilExpiration: number;
  hoursRemaining: number;
  renewalStatus: "RENEWED" | "PENDING" | "AT_RISK";
}

export interface AuthorizationPipelineReport {
  rangeStart: string;
  rangeEnd: string;
  rows: AuthorizationPipelineRow[];
  totals: { renewed: number; pending: number; atRisk: number };
}

export async function authorizationPipelineReport(
  filters: ReportFilters,
): Promise<AuthorizationPipelineReport> {
  const { from, to } = await resolveDateRange(filters);
  const auths = await db
    .select()
    .from(authorizationsTable)
    .where(eq(authorizationsTable.agencyId, filters.agencyId));
  const clients = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.agencyId, filters.agencyId));
  const cMap = new Map(clients.map((c) => [c.id, c]));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + 60);

  const rows: AuthorizationPipelineRow[] = [];
  for (const a of auths) {
    if (filters.clientId && a.clientId !== filters.clientId) continue;
    if (filters.payer && a.payer !== filters.payer) continue;
    const exp = new Date(a.expirationDate + "T00:00:00Z");
    if (exp > horizon) continue;
    const days = Math.round(
      (exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );
    // Renewed if there's a newer authorization for same client/payer that
    // starts after this one's expiration.
    const successor = auths.find(
      (x) =>
        x.id !== a.id &&
        x.clientId === a.clientId &&
        x.payer === a.payer &&
        new Date(x.issuedDate + "T00:00:00Z") >= exp,
    );
    let renewalStatus: AuthorizationPipelineRow["renewalStatus"];
    if (successor) renewalStatus = "RENEWED";
    else if (days <= 14) renewalStatus = "AT_RISK";
    else renewalStatus = "PENDING";
    const remaining =
      Number(a.approvedHoursTotal) - Number(a.hoursUsed);
    rows.push({
      authorizationId: a.id,
      clientId: a.clientId,
      clientName: (() => {
        const c = cMap.get(a.clientId);
        return c ? `${c.firstName} ${c.lastName}` : "Unknown";
      })(),
      payer: a.payer,
      authNumber: a.authNumber,
      expirationDate: a.expirationDate,
      daysUntilExpiration: days,
      hoursRemaining: round2(Math.max(0, remaining)),
      renewalStatus,
    });
  }
  rows.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);

  return {
    rangeStart: from.toISOString().slice(0, 10),
    rangeEnd: to.toISOString().slice(0, 10),
    rows,
    totals: {
      renewed: rows.filter((r) => r.renewalStatus === "RENEWED").length,
      pending: rows.filter((r) => r.renewalStatus === "PENDING").length,
      atRisk: rows.filter((r) => r.renewalStatus === "AT_RISK").length,
    },
  };
}

// =====================================================================
// CSV / PDF helpers
// =====================================================================
const csvEscape = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  const out = [headers.join(",")];
  for (const r of rows) out.push(r.map(csvEscape).join(","));
  return out.join("\n");
}

export function csvHeaderLine(headers: string[]): string {
  return headers.map(csvEscape).join(",") + "\n";
}

export function csvRowLine(row: unknown[]): string {
  return row.map(csvEscape).join(",") + "\n";
}
