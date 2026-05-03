import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import {
  caregiverUtilizationReport,
  clientHoursReport,
  documentComplianceReport,
  overtimeForecastReport,
  visitVerificationReport,
  authorizationPipelineReport,
  csvHeaderLine,
  csvRowLine,
  type ReportFilters,
} from "@workspace/services/reports";
import { AGENCY_ID } from "../lib/agency";

const router: IRouter = Router();

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function filtersFromReq(req: Request): ReportFilters {
  const q = req.query as Record<string, string | undefined>;
  return {
    agencyId: AGENCY_ID,
    from: parseDate(q.from),
    to: parseDate(q.to),
    caregiverId: q.caregiverId,
    clientId: q.clientId,
    payer: q.payer,
  };
}

function streamCsv(
  res: Response,
  filename: string,
  headers: string[],
  rows: Iterable<unknown[]>,
): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}.csv"`,
  );
  res.setHeader("Transfer-Encoding", "chunked");
  res.write(csvHeaderLine(headers));
  for (const row of rows) {
    res.write(csvRowLine(row));
  }
  res.end();
}

interface PdfTableSection {
  title: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

function streamPdf(
  res: Response,
  filename: string,
  title: string,
  subtitle: string,
  sections: PdfTableSection[],
): void {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}.pdf"`,
  );
  const doc = new PDFDocument({ size: "LETTER", margin: 40, layout: "landscape" });
  doc.pipe(res);

  doc.fontSize(18).text("CareOS — " + title, { align: "left" });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor("#666").text(subtitle);
  doc
    .fontSize(9)
    .text(`Generated ${new Date().toISOString()}`, { align: "left" });
  doc.fillColor("black").moveDown(0.5);

  for (const section of sections) {
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor("black").text(section.title);
    doc.moveDown(0.2);
    const startX = doc.x;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colW = usable / section.headers.length;
    doc.fontSize(8).fillColor("#444");
    section.headers.forEach((h, i) => {
      doc.text(h, startX + i * colW, doc.y, {
        width: colW,
        continued: i < section.headers.length - 1,
      });
    });
    doc.moveDown(0.2);
    doc.fillColor("black");
    for (const row of section.rows) {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const yStart = doc.y;
      row.forEach((cell, i) => {
        doc.text(
          cell === null || cell === undefined ? "" : String(cell),
          startX + i * colW,
          yStart,
          {
            width: colW,
            continued: i < row.length - 1,
          },
        );
      });
      doc.moveDown(0.1);
    }
  }

  doc.end();
}

// =============================================================
// Caregiver Utilization
// =============================================================
router.get("/reports/caregiver-utilization", async (req, res) => {
  const data = await caregiverUtilizationReport(filtersFromReq(req));
  res.json(data);
});

router.get("/reports/caregiver-utilization.csv", async (req, res) => {
  const data = await caregiverUtilizationReport(filtersFromReq(req));
  streamCsv(
    res,
    `caregiver-utilization-${data.rangeStart}_${data.rangeEnd}`,
    [
      "Caregiver",
      "Scheduled Hours",
      "Delivered Hours",
      "Utilization %",
      "Overtime Hours",
      "Overtime %",
      "Visits Completed",
      "Missed Visits",
    ],
    (function* () {
      for (const r of data.rows) {
        yield [
          r.caregiverName,
          r.scheduledHours,
          r.deliveredHours,
          r.utilizationPct,
          r.overtimeHours,
          r.overtimePct,
          r.visitsCompleted,
          r.missedVisits,
        ];
      }
    })(),
  );
});

router.get("/reports/caregiver-utilization.pdf", async (req, res) => {
  const data = await caregiverUtilizationReport(filtersFromReq(req));
  streamPdf(
    res,
    `caregiver-utilization-${data.rangeStart}_${data.rangeEnd}`,
    "Caregiver Utilization",
    `${data.rangeStart} to ${data.rangeEnd}`,
    [
      {
        title: "By Caregiver",
        headers: [
          "Caregiver",
          "Sched Hrs",
          "Delivered",
          "Util %",
          "OT Hrs",
          "OT %",
          "Completed",
          "Missed",
        ],
        rows: data.rows.map((r) => [
          r.caregiverName,
          r.scheduledHours,
          r.deliveredHours,
          r.utilizationPct,
          r.overtimeHours,
          r.overtimePct,
          r.visitsCompleted,
          r.missedVisits,
        ]),
      },
      {
        title: "Totals",
        headers: ["Scheduled Hrs", "Delivered Hrs", "OT Hrs", "Missed Visits"],
        rows: [
          [
            data.totals.scheduledHours,
            data.totals.deliveredHours,
            data.totals.overtimeHours,
            data.totals.missedVisits,
          ],
        ],
      },
    ],
  );
});

// =============================================================
// Client Hours vs. Authorized
// =============================================================
router.get("/reports/client-hours", async (req, res) => {
  res.json(await clientHoursReport(filtersFromReq(req)));
});

router.get("/reports/client-hours.csv", async (req, res) => {
  const data = await clientHoursReport(filtersFromReq(req));
  streamCsv(
    res,
    `client-hours-${data.rangeStart}_${data.rangeEnd}`,
    [
      "Client",
      "Payer",
      "Auth #",
      "Approved Hrs",
      "Delivered",
      "Remaining",
      "Drawdown %",
      "Weekly Burn",
      "Expiration",
      "Projected Exhaustion",
    ],
    (function* () {
      for (const r of data.rows) {
        yield [
          r.clientName,
          r.payer,
          r.authNumber,
          r.approvedHoursTotal,
          r.hoursDelivered,
          r.hoursRemaining,
          r.drawdownPct,
          r.weeklyBurnHours,
          r.expirationDate,
          r.projectedExhaustionDate ?? "",
        ];
      }
    })(),
  );
});

router.get("/reports/client-hours.pdf", async (req, res) => {
  const data = await clientHoursReport(filtersFromReq(req));
  streamPdf(
    res,
    `client-hours-${data.rangeStart}_${data.rangeEnd}`,
    "Client Hours vs. Authorized",
    `${data.rangeStart} to ${data.rangeEnd}`,
    [
      {
        title: "By Client / Authorization",
        headers: [
          "Client",
          "Payer",
          "Auth #",
          "Approved",
          "Delivered",
          "Remaining",
          "Drawdown %",
          "Weekly Burn",
          "Expires",
          "Projected Out",
        ],
        rows: data.rows.map((r) => [
          r.clientName,
          r.payer,
          r.authNumber,
          r.approvedHoursTotal,
          r.hoursDelivered,
          r.hoursRemaining,
          r.drawdownPct,
          r.weeklyBurnHours,
          r.expirationDate,
          r.projectedExhaustionDate ?? "—",
        ]),
      },
    ],
  );
});

// =============================================================
// Document Compliance
// =============================================================
router.get("/reports/document-compliance", async (req, res) => {
  res.json(await documentComplianceReport(filtersFromReq(req)));
});

router.get("/reports/document-compliance.csv", async (req, res) => {
  const data = await documentComplianceReport(filtersFromReq(req));
  streamCsv(
    res,
    `document-compliance-${data.rangeEnd}`,
    ["Caregiver", "Document Type", "Expiration", "Days Until", "Status"],
    (function* () {
      for (const r of data.rows) {
        yield [
          r.caregiverName,
          r.documentType,
          r.expirationDate ?? "",
          r.daysUntilExpiration ?? "",
          r.status,
        ];
      }
    })(),
  );
});

router.get("/reports/document-compliance.pdf", async (req, res) => {
  const data = await documentComplianceReport(filtersFromReq(req));
  streamPdf(
    res,
    `document-compliance-${data.rangeEnd}`,
    "Document Compliance",
    `As of ${data.rangeEnd}`,
    [
      {
        title: "Caregiver Documents",
        headers: [
          "Caregiver",
          "Document Type",
          "Expiration",
          "Days Until",
          "Status",
        ],
        rows: data.rows.map((r) => [
          r.caregiverName,
          r.documentType,
          r.expirationDate ?? "—",
          r.daysUntilExpiration ?? "—",
          r.status,
        ]),
      },
      {
        title: "Totals",
        headers: ["Expired", "Expiring (30d)", "Overdue Training"],
        rows: [
          [
            data.totals.expired,
            data.totals.expiring,
            data.totals.overdueTraining,
          ],
        ],
      },
    ],
  );
});

// =============================================================
// OT Exposure Forecast
// =============================================================
router.get("/reports/overtime-forecast", async (req, res) => {
  res.json(await overtimeForecastReport(filtersFromReq(req)));
});

router.get("/reports/overtime-forecast.csv", async (req, res) => {
  const data = await overtimeForecastReport(filtersFromReq(req));
  streamCsv(
    res,
    `overtime-forecast-${data.rangeStart}_${data.rangeEnd}`,
    [
      "Caregiver",
      "This Period OT Hours",
      "This Period OT Cost",
      "Next Period OT Hours",
      "Next Period OT Cost",
    ],
    (function* () {
      for (const r of data.rows) {
        yield [
          r.caregiverName,
          r.thisPeriodOvertimeHours,
          r.thisPeriodOvertimeCost,
          r.nextPeriodOvertimeHours,
          r.nextPeriodOvertimeCost,
        ];
      }
    })(),
  );
});

router.get("/reports/overtime-forecast.pdf", async (req, res) => {
  const data = await overtimeForecastReport(filtersFromReq(req));
  streamPdf(
    res,
    `overtime-forecast-${data.rangeStart}_${data.rangeEnd}`,
    "Overtime Exposure Forecast",
    `${data.rangeStart} to ${data.rangeEnd} • Rule: ${data.ruleName}`,
    [
      {
        title: "By Caregiver",
        headers: [
          "Caregiver",
          "This Pd OT Hrs",
          "This Pd OT $",
          "Next Pd OT Hrs",
          "Next Pd OT $",
        ],
        rows: data.rows.map((r) => [
          r.caregiverName,
          r.thisPeriodOvertimeHours,
          `$${r.thisPeriodOvertimeCost.toFixed(2)}`,
          r.nextPeriodOvertimeHours,
          `$${r.nextPeriodOvertimeCost.toFixed(2)}`,
        ]),
      },
      {
        title: "Totals",
        headers: [
          "This Pd OT Hrs",
          "This Pd OT $",
          "Next Pd OT Hrs",
          "Next Pd OT $",
        ],
        rows: [
          [
            data.totals.thisPeriodOvertimeHours,
            `$${data.totals.thisPeriodOvertimeCost.toFixed(2)}`,
            data.totals.nextPeriodOvertimeHours,
            `$${data.totals.nextPeriodOvertimeCost.toFixed(2)}`,
          ],
        ],
      },
    ],
  );
});

// =============================================================
// Visit Verification
// =============================================================
router.get("/reports/visit-verification", async (req, res) => {
  res.json(await visitVerificationReport(filtersFromReq(req)));
});

router.get("/reports/visit-verification.csv", async (req, res) => {
  const data = await visitVerificationReport(filtersFromReq(req));
  streamCsv(
    res,
    `visit-verification-${data.rangeStart}_${data.rangeEnd}`,
    [
      "Visit ID",
      "Caregiver",
      "Client",
      "Work Date",
      "Status",
      "Exception Reason",
      "Minutes To Verify",
    ],
    (function* () {
      for (const r of data.rows) {
        yield [
          r.visitId,
          r.caregiverName,
          r.clientName,
          r.workDate,
          r.status,
          r.exceptionReason ?? "",
          r.minutesToVerify ?? "",
        ];
      }
    })(),
  );
});

router.get("/reports/visit-verification.pdf", async (req, res) => {
  const data = await visitVerificationReport(filtersFromReq(req));
  streamPdf(
    res,
    `visit-verification-${data.rangeStart}_${data.rangeEnd}`,
    "Visit Verification",
    `${data.rangeStart} to ${data.rangeEnd}`,
    [
      {
        title: "Summary",
        headers: [
          "Total",
          "Verified",
          "Exception",
          "Pending",
          "Rejected",
          "Verify Rate %",
          "Avg Min To Verify",
        ],
        rows: [
          [
            data.totalVisits,
            data.verifiedCount,
            data.exceptionCount,
            data.pendingCount,
            data.rejectedCount,
            data.verificationRatePct,
            data.averageMinutesToVerify ?? "—",
          ],
        ],
      },
      {
        title: "Exception Reasons",
        headers: ["Reason", "Count"],
        rows: data.exceptionTypes.map((b) => [b.reason, b.count]),
      },
      {
        title: "Visits",
        headers: [
          "Caregiver",
          "Client",
          "Date",
          "Status",
          "Reason",
          "Min To Verify",
        ],
        rows: data.rows.map((r) => [
          r.caregiverName,
          r.clientName,
          r.workDate,
          r.status,
          r.exceptionReason ?? "—",
          r.minutesToVerify ?? "—",
        ]),
      },
    ],
  );
});

// =============================================================
// Authorization Pipeline
// =============================================================
router.get("/reports/authorization-pipeline", async (req, res) => {
  res.json(await authorizationPipelineReport(filtersFromReq(req)));
});

router.get("/reports/authorization-pipeline.csv", async (req, res) => {
  const data = await authorizationPipelineReport(filtersFromReq(req));
  streamCsv(
    res,
    `authorization-pipeline-${data.rangeEnd}`,
    [
      "Client",
      "Payer",
      "Auth #",
      "Expiration",
      "Days Until",
      "Hours Remaining",
      "Renewal Status",
    ],
    (function* () {
      for (const r of data.rows) {
        yield [
          r.clientName,
          r.payer,
          r.authNumber,
          r.expirationDate,
          r.daysUntilExpiration,
          r.hoursRemaining,
          r.renewalStatus,
        ];
      }
    })(),
  );
});

router.get("/reports/authorization-pipeline.pdf", async (req, res) => {
  const data = await authorizationPipelineReport(filtersFromReq(req));
  streamPdf(
    res,
    `authorization-pipeline-${data.rangeEnd}`,
    "Authorization Pipeline",
    `As of ${data.rangeEnd}`,
    [
      {
        title: "Authorizations",
        headers: [
          "Client",
          "Payer",
          "Auth #",
          "Expiration",
          "Days Until",
          "Hrs Remaining",
          "Status",
        ],
        rows: data.rows.map((r) => [
          r.clientName,
          r.payer,
          r.authNumber,
          r.expirationDate,
          r.daysUntilExpiration,
          r.hoursRemaining,
          r.renewalStatus,
        ]),
      },
      {
        title: "Totals",
        headers: ["Renewed", "Pending", "At Risk"],
        rows: [
          [data.totals.renewed, data.totals.pending, data.totals.atRisk],
        ],
      },
    ],
  );
});

export default router;
