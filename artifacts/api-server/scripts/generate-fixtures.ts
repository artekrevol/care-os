/* Generate test fixtures: 65-page referral PDF + 10 classifier docs */
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "artifacts/api-server/test-fixtures");
mkdirSync(join(OUT, "referrals"), { recursive: true });
mkdirSync(join(OUT, "classifier"), { recursive: true });

function makePdf(
  filepath: string,
  pages: { title?: string; body: string[] }[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const stream = createWriteStream(filepath);
    doc.pipe(stream);
    pages.forEach((p, idx) => {
      if (idx > 0) doc.addPage();
      if (p.title) {
        doc.fontSize(14).font("Helvetica-Bold").text(p.title);
        doc.moveDown();
      }
      doc.fontSize(10).font("Helvetica");
      for (const para of p.body) {
        doc.text(para);
        doc.moveDown(0.5);
      }
    });
    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

const lorem =
  "Patient is a 78-year-old male diagnosed with congestive heart failure and Type 2 diabetes mellitus. Requires assistance with ADLs including bathing, grooming, transfers, and medication reminders. Lives alone in a single-story home, ambulates with a walker, and is at moderate fall risk. Family supports include adult daughter who lives 25 minutes away.";

async function main() {
  // ---- 65-page comprehensive VA CCN referral ----
  const referralPages: { title?: string; body: string[] }[] = [];
  referralPages.push({
    title: "VA Community Care Network Authorization & Referral Packet",
    body: [
      "Patient: Robert Referral",
      "Date of Birth: 1948-03-12",
      "SSN (last 4): 4421",
      "Address: 1422 Maplewood Drive, Sacramento, CA 95821",
      "Phone: (916) 555-0148",
      "Primary Diagnosis: Congestive Heart Failure (I50.9), Type 2 Diabetes Mellitus (E11.9), Hypertension (I10)",
      "Authorization Number: VA-CCN-2026-77821",
      "Authorized Hours per Week: 24",
      "Total Authorized Hours: 1248",
      "Service Period: 2026-05-01 through 2027-04-30",
      "Primary Payer: VA Community Care Network",
      "Authorizing Provider: Sacramento VA Medical Center, Care Coordination",
      "Reason for Referral: Veteran requires home-based personal care services due to advanced CHF and reduced functional capacity. Spouse deceased; lives alone.",
      "Emergency Contact: Janet Referral (daughter), (916) 555-0207",
    ],
  });
  for (let i = 2; i <= 65; i++) {
    const sections = [
      "Hospital Discharge Summary",
      "Medication Reconciliation",
      "Plan of Care",
      "Functional Assessment",
      "Cognitive Screening (MoCA)",
      "Social History",
      "Wound Care Notes",
      "Cardiology Consult",
      "Endocrinology Consult",
      "Physical Therapy Evaluation",
      "Occupational Therapy Evaluation",
      "Nursing Assessment",
      "Dietary Plan",
      "Caregiver Task List",
      "Safety Assessment",
      "DME Inventory",
      "Insurance Eligibility Verification",
      "Prior Authorization Worksheet",
    ];
    const title = `Page ${i} — ${sections[i % sections.length]}`;
    const body: string[] = [];
    for (let p = 0; p < 8; p++) {
      body.push(
        `${i}.${p + 1}: ${lorem} Repeat block ${i}-${p} to simulate dense clinical narrative content typical of multi-page VA referral packets.`,
      );
    }
    if (i === 7) {
      body.push(
        "AUTHORIZATION SUMMARY: VA-CCN-2026-77821, 24 hrs/wk, 1248 total hrs, 2026-05-01 to 2027-04-30.",
      );
    }
    referralPages.push({ title, body });
  }
  await makePdf(
    join(OUT, "referrals/va-ccn-referral-large.pdf"),
    referralPages,
  );

  // Smaller existing-ish referrals (regenerate as real PDFs)
  await makePdf(join(OUT, "referrals/va-ccn-referral.pdf"), [
    {
      title: "VA CCN Referral",
      body: [
        "Patient: Robert Referral",
        "DOB: 1948-03-12",
        "Authorization: VA-CCN-2026-77821",
        "Hours/week: 24, Total: 1248",
        "Period: 2026-05-01 to 2027-04-30",
        lorem,
      ],
    },
  ]);
  await makePdf(join(OUT, "referrals/medicaid-referral.pdf"), [
    {
      title: "Medicaid HCBS Referral",
      body: [
        "Patient: Maria Gomez",
        "DOB: 1955-11-04",
        "Authorization: HCBS-2026-44120",
        "Hours/week: 32, Total: 1664",
        "Period: 2026-04-15 to 2027-04-14",
        lorem,
      ],
    },
  ]);
  await makePdf(join(OUT, "referrals/private-pay-referral.pdf"), [
    {
      title: "Private Pay Service Agreement",
      body: [
        "Patient: Eleanor Whitfield",
        "DOB: 1942-07-21",
        "Hours/week: 40",
        "Period: 2026-05-01 to 2026-12-31",
        lorem,
      ],
    },
  ]);

  // ---- 10 classifier documents ----
  const classifier: [string, string, string[]][] = [
    [
      "cpr_card.pdf",
      "American Heart Association BLS Provider Card",
      [
        "American Heart Association",
        "Basic Life Support (CPR & AED) Provider",
        "Holder: Maria Hernandez",
        "Issue Date: 2026-02-10",
        "Expiration Date: 2028-02-10",
        "Course Code: BLS-2026-99821",
      ],
    ],
    [
      "tb_test_2026.pdf",
      "Tuberculosis (TB) Skin Test Results",
      [
        "Patient: David Chen",
        "Test: Mantoux Tuberculin (PPD) Skin Test",
        "Placed: 2026-04-12",
        "Read: 2026-04-14",
        "Result: NEGATIVE — 0 mm induration",
        "Next test due: 2027-04-14",
      ],
    ],
    [
      "live_scan_background_check.pdf",
      "DOJ/FBI Live Scan Background Check Clearance",
      [
        "California Department of Justice",
        "Live Scan Submission — Applicant Cleared",
        "Subject: Maria Hernandez",
        "ATI Number: A26045123987",
        "Date Processed: 2026-03-01",
        "Result: NO DISQUALIFYING RECORDS FOUND",
        "Valid for employment as a home care aide.",
      ],
    ],
    [
      "i9_form.pdf",
      "Form I-9 Employment Eligibility Verification",
      [
        "U.S. Citizenship and Immigration Services",
        "Form I-9, Employment Eligibility Verification",
        "Employee Name: Maria Hernandez",
        "List A Document: U.S. Passport",
        "Signed: 2026-01-15",
      ],
    ],
    [
      "w4_form.pdf",
      "Form W-4 Employee's Withholding Certificate",
      [
        "Department of the Treasury — Internal Revenue Service",
        "Form W-4 (2026) — Employee Withholding Allowance",
        "Employee: Maria Hernandez",
        "Filing Status: Single",
        "Signed: 2026-01-15",
      ],
    ],
    [
      "direct_deposit.pdf",
      "Direct Deposit Authorization",
      [
        "Direct Deposit Authorization Form",
        "Employee: Maria Hernandez",
        "Bank: Wells Fargo",
        "Routing Number (ABA): 121000248",
        "Account: ****5512",
      ],
    ],
    [
      "cna_license.pdf",
      "Certified Nursing Assistant License",
      [
        "California Department of Public Health",
        "Certified Nursing Assistant (CNA) Certificate",
        "Holder: Maria Hernandez",
        "Certificate No: CNA-CA-7724501",
        "Issued: 2024-09-01",
        "Expiration: 2026-09-01",
        "Board of Nursing — California",
      ],
    ],
    [
      "training_completion.pdf",
      "Annual In-Service Training Completion",
      [
        "CareOS Training Module — Annual In-Service",
        "Modules: Infection Control, HIPAA, Elder Abuse Reporting",
        "Completed by: Maria Hernandez",
        "Completion Date: 2026-03-22",
      ],
    ],
    [
      "client_care_agreement.pdf",
      "Client Care Service Agreement",
      [
        "Client Care Agreement",
        "Client: Robert Referral",
        "Effective: 2026-05-01",
        "Service Hours: 24 per week",
        "Signed by client representative on 2026-04-28.",
      ],
    ],
    [
      "client_medical_record.pdf",
      "Hospital Discharge Summary — Medical Record",
      [
        "Sacramento VA Medical Center — Hospital Discharge Summary",
        "Patient: Robert Referral",
        "Admit: 2026-04-12 — Discharge: 2026-04-20",
        "Primary Dx: Acute decompensated CHF",
        "Medical history & medication reconciliation attached.",
      ],
    ],
  ];

  for (const [name, title, body] of classifier) {
    await makePdf(join(OUT, `classifier/${name}`), [{ title, body }]);
  }

  console.log("Fixtures generated at", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
