import { sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  caregiversTable,
  authorizationsTable,
  caregiverDocumentsTable,
  schedulesTable,
  visitsTable,
  payPeriodsTable,
  laborRuleSetsTable,
  complianceAlertsTable,
  auditLogTable,
  notificationTypesTable,
  taskTemplatesTable,
  familyUsersTable,
  visitNotesTable,
  visitIncidentsTable,
  carePlansTable,
  messageThreadsTable,
  messagesTable,
  notificationPreferencesTable,
} from "@workspace/db";
import { AGENCY_ID } from "./agency";
import { newId } from "./ids";
import { logger } from "./logger";
import {
  seedChajinelExpansion,
  truncateAgencyDemoData,
} from "./seed-chajinel";

function isoDateNDaysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateAt(daysFromMonday: number, hour: number, minute = 0): Date {
  // Monday = 0
  const now = new Date();
  const day = now.getUTCDay();
  const offset = (day + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - offset);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() + daysFromMonday);
  monday.setUTCHours(hour, minute, 0, 0);
  return monday;
}

async function refreshAnomalyDemoVisit(): Promise<void> {
  // cg_001 logs ~19 hours inside the past 24h window so the hourly anomaly
  // detector flags a LONG_HOURS critical alert on its first run after boot.
  // Requires cg_001 + clt_001 to already exist; safe no-op if they don't.
  const cg = await db
    .select()
    .from(caregiversTable)
    .where(sql`${caregiversTable.id} = 'cg_001' AND ${caregiversTable.agencyId} = ${AGENCY_ID}`)
    .limit(1);
  if (cg.length === 0) return;
  const clockOut = new Date(Date.now() - 3 * 3600 * 1000);
  const clockIn = new Date(clockOut.getTime() - 19 * 3600 * 1000);
  await db
    .insert(visitsTable)
    .values({
      id: "vis_anomaly_long",
      agencyId: AGENCY_ID,
      scheduleId: null,
      caregiverId: "cg_001",
      clientId: "clt_001",
      clockInTime: clockIn,
      clockInLat: "37.7749",
      clockInLng: "-122.4194",
      clockInMethod: "GPS",
      clockOutTime: clockOut,
      clockOutLat: "37.7749",
      clockOutLng: "-122.4194",
      clockOutMethod: "GPS",
      durationMinutes: 19 * 60,
      tasksCompleted: ["Personal care", "Meal prep", "Overnight respite"],
      caregiverNotes: "Covered overnight respite — family had emergency.",
      supervisorNotes: null,
      verificationStatus: "PENDING",
      exceptionReason: null,
      geoFenceMatch: true,
    })
    .onConflictDoUpdate({
      target: visitsTable.id,
      set: {
        clockInTime: clockIn,
        clockOutTime: clockOut,
        durationMinutes: 19 * 60,
      },
    });
}

export async function seed(): Promise<void> {
  // Phase 2 reference rows are idempotent (ON CONFLICT DO NOTHING) and need
  // to run on every boot so newly added types/templates land without a wipe.
  await seedNotificationTypes();
  await seedTaskTemplates();
  await backfillCaregiverPhoneCredentials();

  // Skip Phase 1 demo data if already seeded — but always re-anchor the
  // anomaly demo visit so its timestamps stay within the past 24h window.
  const existing = await db
    .select()
    .from(clientsTable)
    .where(sql`${clientsTable.agencyId} = ${AGENCY_ID}`)
    .limit(1);
  if (existing.length > 0) {
    await refreshAnomalyDemoVisit();
    logger.info("Seed skipped — data already present (anomaly demo refreshed).");
    return;
  }

  logger.info("Seeding CareOS demo data…");

  // Labor rules
  const ruleCA = {
    id: "rule_ca",
    agencyId: AGENCY_ID,
    state: "CA",
    name: "California Domestic Worker Bill of Rights",
    description:
      "California requires overtime after 9 hours in a day for domestic workers, plus standard FLSA weekly OT after 40 hours and double-time after 12 hours in a day. Worked 7 consecutive days in a workweek triggers OT for the first 8 hours of the seventh day and DT thereafter.",
    version: "2026.1",
    overtimeThresholdDailyMinutes: 540, // 9h
    overtimeThresholdWeeklyMinutes: 2400, // 40h
    doubleTimeThresholdDailyMinutes: 720, // 12h
    seventhDayConsecutiveRule: true,
    travelTimeBillable: true,
    isActive: true,
  };
  const ruleFLSA = {
    id: "rule_flsa",
    agencyId: AGENCY_ID,
    state: "US",
    name: "Federal FLSA (default)",
    description:
      "Federal Fair Labor Standards Act baseline: overtime after 40 hours per workweek at 1.5x. No daily OT, no double-time, no seventh-day rule. Companionship-services exemption is not applied to home care aides.",
    version: "2024.2",
    overtimeThresholdDailyMinutes: null,
    overtimeThresholdWeeklyMinutes: 2400,
    doubleTimeThresholdDailyMinutes: null,
    seventhDayConsecutiveRule: false,
    travelTimeBillable: false,
    isActive: false,
  };
  const ruleNY = {
    id: "rule_ny",
    agencyId: AGENCY_ID,
    state: "NY",
    name: "New York Home Care Worker Wage Parity",
    description:
      "New York applies weekly OT after 44 hours for residential home care workers (40h for non-residential). Includes wage parity supplemental benefit minimums in NYC, Nassau, Suffolk, and Westchester counties.",
    version: "2025.3",
    overtimeThresholdDailyMinutes: null,
    overtimeThresholdWeeklyMinutes: 2640,
    doubleTimeThresholdDailyMinutes: null,
    seventhDayConsecutiveRule: false,
    travelTimeBillable: true,
    isActive: false,
  };
  const ruleTX = {
    id: "rule_tx",
    agencyId: AGENCY_ID,
    state: "TX",
    name: "Texas (FLSA-only)",
    description:
      "Texas follows federal FLSA standards with no additional state daily OT or double-time requirements.",
    version: "2024.1",
    overtimeThresholdDailyMinutes: null,
    overtimeThresholdWeeklyMinutes: 2400,
    doubleTimeThresholdDailyMinutes: null,
    seventhDayConsecutiveRule: false,
    travelTimeBillable: false,
    isActive: false,
  };
  await db
    .insert(laborRuleSetsTable)
    .values([ruleCA, ruleFLSA, ruleNY, ruleTX])
    .onConflictDoNothing();

  // Clients
  const clients = [
    {
      id: "clt_001",
      firstName: "Eleanor",
      lastName: "Park",
      dob: "1942-04-12",
      phone: "(415) 555-0184",
      email: null,
      addressLine1: "1244 Hayes St",
      city: "San Francisco",
      state: "CA",
      postalCode: "94117",
      primaryPayer: "VA_CCN",
      status: "APPROVED",
      intakeDate: isoDateNDaysFromNow(-180),
      languages: ["English", "Korean"],
      carePreferences:
        "Prefers female caregivers. Morning routine 7:00-9:00. Light Korean cooking welcome.",
      allergies: "Penicillin, shellfish",
      emergencyContactName: "Daniel Park (son)",
      emergencyContactPhone: "(415) 555-0142",
    },
    {
      id: "clt_002",
      firstName: "Robert",
      lastName: "Velasquez",
      dob: "1938-09-23",
      phone: "(510) 555-0271",
      email: "rvelasquez@example.com",
      addressLine1: "88 Grand Ave Apt 14",
      city: "Oakland",
      state: "CA",
      postalCode: "94612",
      primaryPayer: "COUNTY_IHSS",
      status: "APPROVED",
      intakeDate: isoDateNDaysFromNow(-92),
      languages: ["English", "Spanish"],
      carePreferences:
        "Wheelchair transfers require gait belt. Hard of hearing — face him when speaking.",
      allergies: "Latex",
      emergencyContactName: "Maria Velasquez (daughter)",
      emergencyContactPhone: "(510) 555-0238",
    },
    {
      id: "clt_003",
      firstName: "Margaret",
      lastName: "Okafor",
      dob: "1951-11-02",
      phone: "(650) 555-0319",
      email: null,
      addressLine1: "417 Ralston Ave",
      city: "Belmont",
      state: "CA",
      postalCode: "94002",
      primaryPayer: "PRIVATE_PAY",
      status: "APPROVED",
      intakeDate: isoDateNDaysFromNow(-410),
      languages: ["English"],
      carePreferences:
        "Companion care 4 days/week. Loves chess and audiobooks. Prefers tea over coffee.",
      allergies: null,
      emergencyContactName: "Adaeze Okafor (daughter)",
      emergencyContactPhone: "(650) 555-0287",
    },
    {
      id: "clt_004",
      firstName: "James",
      lastName: "Whitfield",
      dob: "1945-02-18",
      phone: "(925) 555-0102",
      email: null,
      addressLine1: "2210 Mt Diablo Blvd",
      city: "Walnut Creek",
      state: "CA",
      postalCode: "94596",
      primaryPayer: "COUNTY_IHSS",
      status: "APPROVED",
      intakeDate: isoDateNDaysFromNow(-44),
      languages: ["English"],
      carePreferences:
        "Recovery from hip replacement. Needs assistance with PT exercises 3x/day.",
      allergies: "Sulfa drugs",
      emergencyContactName: "Linda Whitfield (wife)",
      emergencyContactPhone: "(925) 555-0107",
    },
    {
      id: "clt_005",
      firstName: "Yuki",
      lastName: "Tanaka",
      dob: "1936-07-30",
      phone: "(408) 555-0498",
      email: null,
      addressLine1: "771 N 5th St",
      city: "San Jose",
      state: "CA",
      postalCode: "95112",
      primaryPayer: "COUNTY_IHSS",
      status: "ON_HOLD",
      intakeDate: isoDateNDaysFromNow(-220),
      languages: ["Japanese", "English"],
      carePreferences:
        "Currently hospitalized — service paused. Resume estimated 5/15.",
      allergies: null,
      emergencyContactName: "Kenji Tanaka (son)",
      emergencyContactPhone: "(408) 555-0455",
    },
    {
      id: "clt_006",
      firstName: "Beatrice",
      lastName: "Holloway",
      dob: "1949-06-14",
      phone: "(707) 555-0612",
      email: null,
      addressLine1: "33 Petaluma Ave",
      city: "Sebastopol",
      state: "CA",
      postalCode: "95472",
      primaryPayer: "PRIVATE_PAY",
      status: "PROSPECT",
      intakeDate: null,
      languages: ["English"],
      carePreferences: "Awaiting initial assessment.",
      allergies: null,
      emergencyContactName: "Thomas Holloway (husband)",
      emergencyContactPhone: "(707) 555-0613",
    },
  ].map((c) => ({ ...c, agencyId: AGENCY_ID }));
  await db.insert(clientsTable).values(clients);

  // Authorizations
  const authorizations = [
    {
      id: "auth_001",
      clientId: "clt_001",
      payer: "VA_CCN",
      authNumber: "VA-2026-09431",
      issuedDate: isoDateNDaysFromNow(-60),
      expirationDate: isoDateNDaysFromNow(8), // expiring soon
      approvedHoursPerWeek: "20.00",
      approvedHoursTotal: "240.00",
      hoursUsed: "168.00",
      scopeOfCare: ["Personal care", "Meal prep", "Medication reminders"],
      documentUrl: null,
    },
    {
      id: "auth_002",
      clientId: "clt_002",
      payer: "MEDICAID_HCBS",
      authNumber: "MCD-CA-118273",
      issuedDate: isoDateNDaysFromNow(-30),
      expirationDate: isoDateNDaysFromNow(150),
      approvedHoursPerWeek: "30.00",
      approvedHoursTotal: "780.00",
      hoursUsed: "112.50",
      scopeOfCare: ["Personal care", "Mobility assist", "Light housekeeping"],
      documentUrl: null,
    },
    {
      id: "auth_003",
      clientId: "clt_003",
      payer: "PRIVATE_PAY",
      authNumber: "PVT-2025-OKAFOR",
      issuedDate: isoDateNDaysFromNow(-200),
      expirationDate: isoDateNDaysFromNow(165),
      approvedHoursPerWeek: "16.00",
      approvedHoursTotal: "832.00",
      hoursUsed: "624.00",
      scopeOfCare: ["Companion care", "Transportation"],
      documentUrl: null,
    },
    {
      id: "auth_004",
      clientId: "clt_004",
      payer: "LTC_INSURANCE",
      authNumber: "GENWORTH-44829",
      issuedDate: isoDateNDaysFromNow(-44),
      expirationDate: isoDateNDaysFromNow(46),
      approvedHoursPerWeek: "35.00",
      approvedHoursTotal: "455.00",
      hoursUsed: "140.00",
      scopeOfCare: ["Personal care", "PT support", "Meal prep"],
      documentUrl: null,
    },
    {
      id: "auth_005",
      clientId: "clt_001",
      payer: "VA_CCN",
      authNumber: "VA-2025-04112",
      issuedDate: isoDateNDaysFromNow(-365),
      expirationDate: isoDateNDaysFromNow(-3), // expired
      approvedHoursPerWeek: "20.00",
      approvedHoursTotal: "1040.00",
      hoursUsed: "1040.00",
      scopeOfCare: ["Personal care"],
      documentUrl: null,
    },
  ].map((a) => ({ ...a, agencyId: AGENCY_ID }));
  await db.insert(authorizationsTable).values(authorizations);

  // Caregivers
  const caregivers = [
    {
      id: "cg_001",
      userId: "user_caregiver_aisha",
      firstName: "Aisha",
      lastName: "Johnson",
      email: "aisha.j@careos.demo",
      phone: "(415) 555-1101",
      employmentType: "W2",
      hireDate: isoDateNDaysFromNow(-720),
      status: "APPROVED",
      languages: ["English"],
      skills: ["Hoyer lift", "Dementia care", "G-tube"],
      payRate: "24.50",
      hasVehicle: true,
      addressCity: "Daly City",
      addressState: "CA",
    },
    {
      id: "cg_002",
      firstName: "Marco",
      lastName: "Rivera",
      email: "marco.r@careos.demo",
      phone: "(510) 555-1102",
      employmentType: "W2",
      hireDate: isoDateNDaysFromNow(-410),
      status: "APPROVED",
      languages: ["English", "Spanish"],
      skills: ["CPR", "Wound care", "Mobility transfers"],
      payRate: "23.00",
      hasVehicle: true,
      addressCity: "Hayward",
      addressState: "CA",
    },
    {
      id: "cg_003",
      firstName: "Linh",
      lastName: "Nguyen",
      email: "linh.n@careos.demo",
      phone: "(408) 555-1103",
      employmentType: "W2",
      hireDate: isoDateNDaysFromNow(-180),
      status: "APPROVED",
      languages: ["English", "Vietnamese"],
      skills: ["Companion care", "Meal prep", "Light housekeeping"],
      payRate: "22.00",
      hasVehicle: false,
      addressCity: "San Jose",
      addressState: "CA",
    },
    {
      id: "cg_004",
      firstName: "Daniel",
      lastName: "Okonkwo",
      email: "daniel.o@careos.demo",
      phone: "(925) 555-1104",
      employmentType: "W2",
      hireDate: isoDateNDaysFromNow(-90),
      status: "APPROVED",
      languages: ["English"],
      skills: ["Hospice support", "Bath assist"],
      payRate: "26.00",
      hasVehicle: true,
      addressCity: "Concord",
      addressState: "CA",
    },
    {
      id: "cg_005",
      firstName: "Sofia",
      lastName: "Martinez",
      email: "sofia.m@careos.demo",
      phone: "(650) 555-1105",
      employmentType: "W2",
      hireDate: isoDateNDaysFromNow(-960),
      status: "APPROVED",
      languages: ["English", "Spanish"],
      skills: ["Hoyer lift", "Wound care", "Insulin support"],
      certifications: ["CNA"],
      payRate: "25.50",
      hasVehicle: true,
      addressCity: "Redwood City",
      addressState: "CA",
    },
    {
      id: "cg_006",
      firstName: "Priya",
      lastName: "Shah",
      email: "priya.s@careos.demo",
      phone: "(408) 555-1106",
      employmentType: "W2",
      hireDate: isoDateNDaysFromNow(-540),
      status: "APPROVED",
      languages: ["English", "Hindi", "Gujarati"],
      skills: ["Companion care", "Medication reminders"],
      payRate: "22.50",
      hasVehicle: true,
      addressCity: "Fremont",
      addressState: "CA",
    },
  ].map((c, i) => ({
    ...c,
    agencyId: AGENCY_ID,
    phoneCode: String(100001 + i),
    // Deterministic demo PINs (anchor positions). Reset flow still requires
    // supervisor action before first real use; this just keeps demo state
    // reproducible and screenshot-stable across `pnpm demo:reset` runs.
    phonePin: String(1001 + i).padStart(4, "0"),
  }));
  await db.insert(caregiversTable).values(caregivers);
  // PIN is auth secret material; never log it. Phone codes are logged so a
  // dev can look up which caregiver received which code, but PINs must be
  // reset by a supervisor through the normal reset flow before first use.
  logger.info(
    { count: caregivers.length },
    "Seeded caregivers with deterministic IVR PINs (must be reset via supervisor flow before first real use)",
  );

  // Caregiver documents
  const docs = [
    // cg_001
    { caregiverId: "cg_001", documentType: "BACKGROUND_CHECK", issuedDate: isoDateNDaysFromNow(-700), expirationDate: isoDateNDaysFromNow(330) },
    { caregiverId: "cg_001", documentType: "TB_TEST", issuedDate: isoDateNDaysFromNow(-120), expirationDate: isoDateNDaysFromNow(245) },
    { caregiverId: "cg_001", documentType: "CPR", issuedDate: isoDateNDaysFromNow(-700), expirationDate: isoDateNDaysFromNow(15) }, // expiring
    { caregiverId: "cg_001", documentType: "I9", issuedDate: isoDateNDaysFromNow(-720), expirationDate: null },
    // cg_002
    { caregiverId: "cg_002", documentType: "BACKGROUND_CHECK", issuedDate: isoDateNDaysFromNow(-400), expirationDate: isoDateNDaysFromNow(-12) }, // expired
    { caregiverId: "cg_002", documentType: "TB_TEST", issuedDate: isoDateNDaysFromNow(-100), expirationDate: isoDateNDaysFromNow(265) },
    { caregiverId: "cg_002", documentType: "CPR", issuedDate: isoDateNDaysFromNow(-400), expirationDate: isoDateNDaysFromNow(330) },
    { caregiverId: "cg_002", documentType: "I9", issuedDate: isoDateNDaysFromNow(-410), expirationDate: null },
    // cg_003
    { caregiverId: "cg_003", documentType: "BACKGROUND_CHECK", issuedDate: isoDateNDaysFromNow(-170), expirationDate: isoDateNDaysFromNow(560) },
    { caregiverId: "cg_003", documentType: "TB_TEST", issuedDate: isoDateNDaysFromNow(-170), expirationDate: isoDateNDaysFromNow(195) },
    { caregiverId: "cg_003", documentType: "CPR", issuedDate: isoDateNDaysFromNow(-180), expirationDate: isoDateNDaysFromNow(540) },
    { caregiverId: "cg_003", documentType: "I9", issuedDate: isoDateNDaysFromNow(-180), expirationDate: null },
    // cg_004
    { caregiverId: "cg_004", documentType: "BACKGROUND_CHECK", issuedDate: isoDateNDaysFromNow(-85), expirationDate: isoDateNDaysFromNow(640) },
    { caregiverId: "cg_004", documentType: "TB_TEST", issuedDate: isoDateNDaysFromNow(-85), expirationDate: isoDateNDaysFromNow(280) },
    { caregiverId: "cg_004", documentType: "CPR", issuedDate: isoDateNDaysFromNow(-90), expirationDate: isoDateNDaysFromNow(635) },
    // cg_005
    { caregiverId: "cg_005", documentType: "BACKGROUND_CHECK", issuedDate: isoDateNDaysFromNow(-940), expirationDate: isoDateNDaysFromNow(125) },
    { caregiverId: "cg_005", documentType: "TB_TEST", issuedDate: isoDateNDaysFromNow(-15), expirationDate: isoDateNDaysFromNow(350) },
    { caregiverId: "cg_005", documentType: "CPR", issuedDate: isoDateNDaysFromNow(-360), expirationDate: isoDateNDaysFromNow(7) }, // expiring imminent
    { caregiverId: "cg_005", documentType: "I9", issuedDate: isoDateNDaysFromNow(-960), expirationDate: null },
    { caregiverId: "cg_005", documentType: "DIRECT_DEPOSIT", issuedDate: isoDateNDaysFromNow(-960), expirationDate: null },
  ].map((d) => ({
    ...d,
    id: newId("doc"),
    agencyId: AGENCY_ID,
    fileUrl: null,
  }));
  await db.insert(caregiverDocumentsTable).values(docs);

  // Schedules — current week, dense enough to project OT under CA rule
  const schedulePairs = [
    // Aisha — heavy week (will hit weekly OT under CA)
    { day: 0, startH: 7, endH: 16, cg: "cg_001", clt: "clt_001", auth: "auth_001" }, // 9h
    { day: 1, startH: 7, endH: 17, cg: "cg_001", clt: "clt_001", auth: "auth_001" }, // 10h - 1h OT
    { day: 2, startH: 7, endH: 16, cg: "cg_001", clt: "clt_001", auth: "auth_001" },
    { day: 3, startH: 7, endH: 16, cg: "cg_001", clt: "clt_001", auth: "auth_001" },
    { day: 4, startH: 7, endH: 18, cg: "cg_001", clt: "clt_001", auth: "auth_001" }, // 11h
    // Marco — split between two clients
    { day: 0, startH: 8, endH: 14, cg: "cg_002", clt: "clt_002", auth: "auth_002" },
    { day: 1, startH: 8, endH: 14, cg: "cg_002", clt: "clt_002", auth: "auth_002" },
    { day: 2, startH: 8, endH: 14, cg: "cg_002", clt: "clt_002", auth: "auth_002" },
    { day: 3, startH: 8, endH: 14, cg: "cg_002", clt: "clt_002", auth: "auth_002" },
    { day: 4, startH: 8, endH: 14, cg: "cg_002", clt: "clt_002", auth: "auth_002" },
    // Linh — Margaret companion days
    { day: 0, startH: 10, endH: 14, cg: "cg_003", clt: "clt_003", auth: "auth_003" },
    { day: 2, startH: 10, endH: 14, cg: "cg_003", clt: "clt_003", auth: "auth_003" },
    { day: 4, startH: 10, endH: 14, cg: "cg_003", clt: "clt_003", auth: "auth_003" },
    // Daniel — James (recovering hip, intensive)
    { day: 0, startH: 9, endH: 16, cg: "cg_004", clt: "clt_004", auth: "auth_004" },
    { day: 1, startH: 9, endH: 16, cg: "cg_004", clt: "clt_004", auth: "auth_004" },
    { day: 2, startH: 9, endH: 16, cg: "cg_004", clt: "clt_004", auth: "auth_004" },
    { day: 3, startH: 9, endH: 16, cg: "cg_004", clt: "clt_004", auth: "auth_004" },
    { day: 4, startH: 9, endH: 16, cg: "cg_004", clt: "clt_004", auth: "auth_004" },
    // Sofia — long days with one CA daily-OT trigger
    { day: 1, startH: 7, endH: 17, cg: "cg_005", clt: "clt_002", auth: "auth_002" }, // 10h
    { day: 3, startH: 7, endH: 19, cg: "cg_005", clt: "clt_002", auth: "auth_002" }, // 12h - DT trigger
    { day: 5, startH: 8, endH: 14, cg: "cg_005", clt: "clt_004", auth: "auth_004" },
  ];
  const scheduleRows = schedulePairs.map((s, i) => {
    const start = dateAt(s.day, s.startH);
    const end = dateAt(s.day, s.endH);
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    return {
      id: `sch_${String(i + 1).padStart(3, "0")}`,
      agencyId: AGENCY_ID,
      clientId: s.clt,
      caregiverId: s.cg,
      authorizationId: s.auth,
      startTime: start,
      endTime: end,
      scheduledMinutes: minutes,
      serviceCode: "G0156",
      serviceDescription: "Home health aide services",
      status: "SCHEDULED" as const,
      notes: null,
    };
  });
  await db.insert(schedulesTable).values(scheduleRows);

  // Visits — last pay period (verified) + a few this week (mixed states)
  const lastPeriodStart = (() => {
    const d = new Date();
    const day = d.getUTCDay();
    const offset = (day + 6) % 7 + 14;
    d.setUTCDate(d.getUTCDate() - offset);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();

  const visitsToInsert: (typeof visitsTable.$inferInsert)[] = [];
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    for (const cg of ["cg_001", "cg_002", "cg_004", "cg_005"]) {
      const clientByCg: Record<string, string> = {
        cg_001: "clt_001",
        cg_002: "clt_002",
        cg_004: "clt_004",
        cg_005: "clt_002",
      };
      const dow = (lastPeriodStart.getUTCDay() + dayOffset) % 7;
      if (dow === 0 || dow === 6) continue; // skip weekends in history
      const start = new Date(lastPeriodStart);
      start.setUTCDate(start.getUTCDate() + dayOffset);
      const startHour = cg === "cg_001" ? 7 : cg === "cg_004" ? 9 : 8;
      const endHour =
        cg === "cg_001" && dayOffset % 5 === 1
          ? 17 // some 10h days for OT
          : cg === "cg_005" && dayOffset === 3
            ? 19
            : startHour + 7;
      start.setUTCHours(startHour, 0, 0, 0);
      const end = new Date(start);
      end.setUTCHours(endHour, 0, 0, 0);
      const dur = Math.round((end.getTime() - start.getTime()) / 60000);
      visitsToInsert.push({
        id: newId("vis"),
        agencyId: AGENCY_ID,
        scheduleId: null,
        caregiverId: cg,
        clientId: clientByCg[cg],
        clockInTime: start,
        clockInLat: "37.7749",
        clockInLng: "-122.4194",
        clockInMethod: "GPS",
        clockOutTime: end,
        clockOutLat: "37.7749",
        clockOutLng: "-122.4194",
        clockOutMethod: "GPS",
        durationMinutes: dur,
        tasksCompleted: ["Personal care", "Meal prep", "Medication reminders"],
        caregiverNotes: "Routine visit completed.",
        supervisorNotes: null,
        verificationStatus: "VERIFIED",
        exceptionReason: null,
        geoFenceMatch: true,
      });
    }
  }

  // A few visits this week — pending and exception
  visitsToInsert.push({
    id: "vis_pending_001",
    agencyId: AGENCY_ID,
    scheduleId: null,
    caregiverId: "cg_002",
    clientId: "clt_002",
    clockInTime: dateAt(0, 8, 3),
    clockInLat: "37.8044",
    clockInLng: "-122.2711",
    clockInMethod: "GPS",
    clockOutTime: dateAt(0, 14, 1),
    clockOutLat: "37.8044",
    clockOutLng: "-122.2711",
    clockOutMethod: "GPS",
    durationMinutes: 358,
    tasksCompleted: ["Mobility assist", "Light housekeeping"],
    caregiverNotes: "Client refused breakfast.",
    supervisorNotes: null,
    verificationStatus: "PENDING",
    exceptionReason: null,
    geoFenceMatch: true,
  });
  visitsToInsert.push({
    id: "vis_exception_001",
    agencyId: AGENCY_ID,
    scheduleId: null,
    caregiverId: "cg_003",
    clientId: "clt_003",
    clockInTime: dateAt(0, 10, 12),
    clockInLat: "37.5103",
    clockInLng: "-122.2961",
    clockInMethod: "GPS",
    clockOutTime: dateAt(0, 13, 47),
    clockOutLat: "37.5230", // ~2km off
    clockOutLng: "-122.3110",
    clockOutMethod: "GPS",
    durationMinutes: 215,
    tasksCompleted: ["Companion care"],
    caregiverNotes: "Took client to library — outside usual route.",
    supervisorNotes: null,
    verificationStatus: "EXCEPTION",
    exceptionReason: "GPS clock-out 1.8km outside client geofence",
    geoFenceMatch: false,
  });
  visitsToInsert.push({
    id: "vis_pending_002",
    agencyId: AGENCY_ID,
    scheduleId: null,
    caregiverId: "cg_001",
    clientId: "clt_001",
    clockInTime: dateAt(1, 7, 0),
    clockInLat: "37.7749",
    clockInLng: "-122.4194",
    clockInMethod: "GPS",
    clockOutTime: dateAt(1, 17, 8),
    clockOutLat: "37.7749",
    clockOutLng: "-122.4194",
    clockOutMethod: "GPS",
    durationMinutes: 608,
    tasksCompleted: ["Personal care", "Meal prep", "Medication reminders", "Light housekeeping"],
    caregiverNotes: "Long day — Eleanor had family visit.",
    supervisorNotes: null,
    verificationStatus: "PENDING",
    exceptionReason: null,
    geoFenceMatch: true,
  });
  await db.insert(visitsTable).values(visitsToInsert);

  // Anomaly demo visit: cg_001 logs 19 hours inside the past 24h window so
  // the hourly anomaly detector flags a LONG_HOURS critical alert on its
  // first run after seed/boot.
  await refreshAnomalyDemoVisit();

  // Phase 2.5 — Chajinel expansion: scale to 32 caregivers, 24 clients,
  // 4 weeks of visit history, fall incident, LOW renewal prediction, and
  // referral PDF intake pointer. Anchors above carry every original magic
  // moment; this layer adds breadth.
  await seedChajinelExpansion();

  // Pay periods — one CLOSED last period, one OPEN current
  const lastPeriodEnd = new Date(lastPeriodStart);
  lastPeriodEnd.setUTCDate(lastPeriodEnd.getUTCDate() + 13);
  const currentStart = new Date(lastPeriodEnd);
  currentStart.setUTCDate(currentStart.getUTCDate() + 1);
  const currentEnd = new Date(currentStart);
  currentEnd.setUTCDate(currentEnd.getUTCDate() + 13);
  await db.insert(payPeriodsTable).values([
    {
      id: "pp_open",
      agencyId: AGENCY_ID,
      startDate: currentStart.toISOString().slice(0, 10),
      endDate: currentEnd.toISOString().slice(0, 10),
      status: "OPEN",
      exportedAt: null,
    },
    {
      id: "pp_prev",
      agencyId: AGENCY_ID,
      startDate: lastPeriodStart.toISOString().slice(0, 10),
      endDate: lastPeriodEnd.toISOString().slice(0, 10),
      status: "OPEN", // will be closed on demand
      exportedAt: null,
    },
  ]);

  // Compliance alerts seeded from data states above
  await db.insert(complianceAlertsTable).values([
    {
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "AUTH_EXPIRING",
      severity: "HIGH",
      entityType: "Authorization",
      entityId: "auth_001",
      title: "VA authorization for Eleanor Park expires in 8 days",
      message:
        "VA-2026-09431 expires soon. Renewal request must be submitted to the VA Community Care office before the expiration date.",
      suggestedAction:
        "Fax VA CCN renewal packet to (877) 881-7618 with current care plan, last 30 days of visit logs, and updated physician order. Confirm receipt within 48 hours.",
      status: "OPEN",
    },
    {
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "AUTH_EXPIRED",
      severity: "CRITICAL",
      entityType: "Authorization",
      entityId: "auth_005",
      title: "Prior VA authorization for Eleanor Park has expired",
      message: "VA-2025-04112 lapsed 3 days ago.",
      status: "ACKNOWLEDGED",
    },
    {
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "DOC_EXPIRED",
      severity: "HIGH",
      entityType: "Caregiver",
      entityId: "cg_002",
      title: "Background check expired for Marco Rivera",
      message:
        "Marco's background check lapsed 12 days ago. Caregiver should not be scheduled until a fresh check is processed.",
      status: "OPEN",
    },
    {
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "DOC_EXPIRING",
      severity: "MEDIUM",
      entityType: "Caregiver",
      entityId: "cg_001",
      title: "CPR certification expiring for Aisha Johnson (15 days)",
      message: "Schedule a recert before May 18.",
      status: "OPEN",
    },
    {
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "OT_THRESHOLD",
      severity: "MEDIUM",
      entityType: "Caregiver",
      entityId: "cg_001",
      title: "Aisha Johnson projected over 40h/week",
      message:
        "Schedule projects 49h next week — will incur 9h of CA daily/weekly OT under the active rule.",
      status: "OPEN",
    },
    {
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "GEO_MISMATCH",
      severity: "HIGH",
      entityType: "Visit",
      entityId: "vis_exception_001",
      title: "GPS mismatch on Linh Nguyen visit",
      message: "Clock-out location 1.8km outside Margaret Okafor's geofence.",
      status: "OPEN",
    },
  ]);

  // Seed audit entries for the activity feed
  await db.insert(auditLogTable).values([
    {
      id: newId("aud"),
      agencyId: AGENCY_ID,
      userId: "user_admin",
      userName: "Casey Admin",
      action: "CREATE_CLIENT",
      entityType: "Client",
      entityId: "clt_006",
      summary: "Intake started for Beatrice Holloway",
    },
    {
      id: newId("aud"),
      agencyId: AGENCY_ID,
      userId: "user_admin",
      userName: "Casey Admin",
      action: "CREATE_SCHEDULE",
      entityType: "Schedule",
      entityId: "sch_018",
      summary: "Scheduled Daniel Okonkwo → James Whitfield this week",
    },
    {
      id: newId("aud"),
      agencyId: AGENCY_ID,
      userId: "user_admin",
      userName: "Casey Admin",
      action: "VERIFY_VISIT",
      entityType: "Visit",
      entityId: visitsToInsert[0]?.id ?? "vis_unknown",
      summary: "Visit verified for prior pay period",
    },
    {
      id: newId("aud"),
      agencyId: AGENCY_ID,
      userId: "user_admin",
      userName: "Casey Admin",
      action: "VISIT_EXCEPTION",
      entityType: "Visit",
      entityId: "vis_exception_001",
      summary: "Visit flagged: GPS clock-out outside geofence",
    },
    {
      id: newId("aud"),
      agencyId: AGENCY_ID,
      userId: "user_admin",
      userName: "Casey Admin",
      action: "SET_ACTIVE_LABOR_RULE",
      entityType: "LaborRuleSet",
      entityId: "rule_ca",
      summary: "Active labor rule set to California Domestic Worker (CA)",
    },
  ]);

  // Family portal: invited + already-accepted family members per client
  const familyUsers = [
    {
      id: "fam_001",
      clientId: "clt_001",
      email: "daniel.park@example.com",
      phone: "(415) 555-0142",
      firstName: "Daniel",
      lastName: "Park",
      relationship: "Son",
    },
    {
      id: "fam_002",
      clientId: "clt_002",
      email: "maria.velasquez@example.com",
      phone: "(510) 555-0238",
      firstName: "Maria",
      lastName: "Velasquez",
      relationship: "Daughter",
    },
    {
      id: "fam_003",
      clientId: "clt_003",
      email: "adaeze.okafor@example.com",
      phone: "(650) 555-0287",
      firstName: "Adaeze",
      lastName: "Okafor",
      relationship: "Daughter",
    },
  ].map((f) => ({
    ...f,
    agencyId: AGENCY_ID,
    accessLevel: "VIEWER" as const,
    invitedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    invitedBy: "user_admin",
    acceptedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    isActive: true,
    inviteToken: null,
    inviteTokenExpiresAt: null,
  }));
  await db.insert(familyUsersTable).values(familyUsers);

  // Care plans — one ACTIVE per active client + one PENDING_APPROVAL example
  await db.insert(carePlansTable).values([
    {
      id: "cp_001",
      agencyId: AGENCY_ID,
      clientId: "clt_001",
      version: 2,
      status: "APPROVED",
      title: "Eleanor Park — Daily Living Support",
      goals: [
        { id: "g1", title: "Maintain morning routine independence", measurable: "Self-directs 4 of 5 mornings" },
        { id: "g2", title: "Stay socially engaged through Korean-language conversation" },
        { id: "g3", title: "Avoid medication errors" },
      ] as never,
      tasks: [
        { id: "t1", title: "Bathing assistance", category: "ADL", frequency: "Daily 7:00", defaultMinutes: 20 },
        { id: "t2", title: "Medication reminders", category: "MEDICATION", frequency: "Daily 8:00 & 18:00", defaultMinutes: 5 },
        { id: "t3", title: "Light Korean cooking", category: "MEAL", frequency: "Daily 8:00", defaultMinutes: 30 },
        { id: "t4", title: "Companionship & conversation", category: "COMPANIONSHIP", frequency: "Daily", defaultMinutes: 30 },
      ] as never,
      riskFactors: ["Penicillin allergy", "Mild balance issues — fall risk"] as never,
      preferences: {
        languagePreference: "Korean greetings preferred",
        caregiverGender: "female",
        culturalNotes: "Remove shoes at entry",
      } as never,
      effectiveStart: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      authoredBy: "user_admin",
      approvedBy: "fam_001",
      approvedAt: new Date(Date.now() - 88 * 24 * 60 * 60 * 1000),
    },
    {
      id: "cp_002",
      agencyId: AGENCY_ID,
      clientId: "clt_002",
      version: 1,
      status: "APPROVED",
      title: "Robert Velasquez — Mobility & Hearing Support",
      goals: [
        { id: "g1", title: "Safe wheelchair transfers with gait belt" },
        { id: "g2", title: "Minimize hearing-related miscommunication" },
      ] as never,
      tasks: [
        { id: "t1", title: "Mobility & transfer assist", category: "ADL", frequency: "Daily", defaultMinutes: 15 },
        { id: "t2", title: "Light housekeeping", category: "HOUSEKEEPING", frequency: "Mon/Wed/Fri", defaultMinutes: 30 },
        { id: "t3", title: "Companionship & conversation", category: "COMPANIONSHIP", frequency: "Daily", defaultMinutes: 30 },
      ] as never,
      riskFactors: ["Latex allergy", "Hard of hearing"] as never,
      preferences: { caregiverInstruction: "Face client when speaking; speak clearly" } as never,
      effectiveStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      authoredBy: "user_admin",
      approvedBy: "fam_002",
      approvedAt: new Date(Date.now() - 58 * 24 * 60 * 60 * 1000),
    },
    {
      id: "cp_003",
      agencyId: AGENCY_ID,
      clientId: "clt_003",
      version: 1,
      status: "APPROVED",
      title: "Margaret Okafor — Companion Care Plan",
      goals: [
        { id: "g1", title: "Maintain cognitive engagement" },
        { id: "g2", title: "Support social outings on care days" },
      ] as never,
      tasks: [
        { id: "t1", title: "Cognitive engagement (chess, audiobooks)", category: "COMPANIONSHIP", frequency: "Mon/Wed/Fri", defaultMinutes: 60 },
        { id: "t2", title: "Walk / outdoor activity", category: "EXERCISE", frequency: "Mon/Wed/Fri", defaultMinutes: 30 },
        { id: "t3", title: "Light housekeeping", category: "HOUSEKEEPING", frequency: "Weekly", defaultMinutes: 45 },
      ] as never,
      riskFactors: [] as never,
      preferences: { beverage: "Tea preferred over coffee" } as never,
      effectiveStart: new Date(Date.now() - 410 * 24 * 60 * 60 * 1000),
      authoredBy: "user_admin",
      approvedBy: "fam_003",
      approvedAt: new Date(Date.now() - 408 * 24 * 60 * 60 * 1000),
    },
    {
      id: "cp_004",
      agencyId: AGENCY_ID,
      clientId: "clt_004",
      version: 1,
      status: "APPROVED",
      title: "James Whitfield — Post-Hip Recovery & Mobility",
      goals: [
        { id: "g1", title: "Complete hip-replacement PT regimen safely" },
        { id: "g2", title: "Restore independent ambulation by 8 weeks post-op" },
      ] as never,
      tasks: [
        { id: "t1", title: "Bathing & dressing assist", category: "ADL", frequency: "Daily 7:30", defaultMinutes: 25 },
        { id: "t2", title: "PT exercises (per home program)", category: "EXERCISE", frequency: "3x daily", defaultMinutes: 20 },
        { id: "t3", title: "Mobility & transfer support", category: "ADL", frequency: "Each visit", defaultMinutes: 15 },
        { id: "t4", title: "Meal prep", category: "MEAL", frequency: "Daily", defaultMinutes: 30 },
        { id: "t5", title: "Light housekeeping", category: "HOUSEKEEPING", frequency: "Mon/Wed/Fri", defaultMinutes: 30 },
        { id: "t6", title: "Companionship", category: "COMPANIONSHIP", frequency: "Daily", defaultMinutes: 20 },
      ] as never,
      riskFactors: ["Recent hip replacement — fall risk", "Sulfa drug allergy"] as never,
      preferences: { caregiverInstruction: "Use gait belt for all transfers" } as never,
      effectiveStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      authoredBy: "user_admin",
      approvedBy: "user_admin",
      approvedAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
    },
    {
      id: "cp_005",
      agencyId: AGENCY_ID,
      clientId: "clt_005",
      version: 1,
      status: "APPROVED",
      title: "Yuki Tanaka — Resumption Plan (Service Paused)",
      goals: [
        { id: "g1", title: "Safe resumption of in-home care after hospital discharge" },
        { id: "g2", title: "Maintain mobility and prevent deconditioning during pause" },
      ] as never,
      tasks: [
        { id: "t1", title: "Personal care assist (resume on discharge)", category: "ADL", frequency: "Daily", defaultMinutes: 30 },
        { id: "t2", title: "Light meal prep", category: "MEAL", frequency: "Daily", defaultMinutes: 30 },
        { id: "t3", title: "Companionship & wellness check", category: "COMPANIONSHIP", frequency: "Daily", defaultMinutes: 30 },
        { id: "t4", title: "Medication reminders", category: "MEDICATION", frequency: "Twice daily", defaultMinutes: 10 },
      ] as never,
      riskFactors: ["Recent hospitalization", "Service paused — verify discharge orders before resume"] as never,
      preferences: { caregiverInstruction: "Japanese-preferred when possible. Family will confirm resume date." } as never,
      effectiveStart: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      authoredBy: "user_admin",
      approvedBy: "user_admin",
      approvedAt: new Date(Date.now() - 195 * 24 * 60 * 60 * 1000),
    },
    {
      id: "cp_006",
      agencyId: AGENCY_ID,
      clientId: "clt_006",
      version: 1,
      status: "APPROVED",
      title: "Beatrice Holloway — Initial Companion Care Plan",
      goals: [
        { id: "g1", title: "Establish daily routine and rapport with caregiver" },
        { id: "g2", title: "Support independence at home with light assistance" },
      ] as never,
      tasks: [
        { id: "t1", title: "Companion visit & wellness check", category: "COMPANIONSHIP", frequency: "Mon/Wed/Fri", defaultMinutes: 60 },
        { id: "t2", title: "Light meal prep", category: "MEAL", frequency: "Each visit", defaultMinutes: 30 },
        { id: "t3", title: "Errands & transportation", category: "IADL", frequency: "Weekly", defaultMinutes: 60 },
        { id: "t4", title: "Light housekeeping", category: "HOUSEKEEPING", frequency: "Weekly", defaultMinutes: 45 },
      ] as never,
      riskFactors: ["New client — assessment pending"] as never,
      preferences: { caregiverInstruction: "Prospect intake. Confirm assessment before first visit." } as never,
      effectiveStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      authoredBy: "user_admin",
      approvedBy: "user_admin",
      approvedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  ]);

  // Family-visible visit notes + an incident
  await db.insert(visitNotesTable).values([
    {
      id: newId("note"),
      agencyId: AGENCY_ID,
      visitId: "vis_pending_002", // clt_001 (Eleanor Park)
      authorId: "cg_001",
      authorRole: "CAREGIVER",
      body: "Eleanor enjoyed her morning walk and ate a full breakfast. Took medications on schedule.",
      voiceClipUrl: null,
      aiSummary: "Routine morning visit. Good appetite, all meds taken.",
    },
    {
      id: newId("note"),
      agencyId: AGENCY_ID,
      visitId: "vis_pending_001", // clt_002 (Robert Velasquez)
      authorId: "cg_002",
      authorRole: "CAREGIVER",
      body: "Robert refused breakfast this morning but accepted a smoothie at 10am. Mobility transfer went well with the gait belt.",
      voiceClipUrl: null,
      aiSummary: null,
    },
  ]);
  await db.insert(visitIncidentsTable).values([
    {
      id: newId("inc"),
      agencyId: AGENCY_ID,
      visitId: "vis_exception_001", // clt_003 (Margaret Okafor)
      reportedBy: "cg_003",
      severity: "LOW",
      category: "BEHAVIOR",
      description: "Margaret was confused returning from the library outing. Calmed within 10 minutes after orientation cues.",
      photoUrls: [],
    },
  ]);

  // Message threads — family ↔ agency
  const threadEleanor = {
    id: "thr_001",
    agencyId: AGENCY_ID,
    clientId: "clt_001",
    caregiverId: null,
    topic: "GENERAL",
    subject: "Mom's morning routine",
    participants: [
      { userId: "fam_001", role: "FAMILY", name: "Daniel Park" },
      { userId: "user_admin", role: "AGENCY", name: "Casey Admin" },
    ],
    lastMessageAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  };
  const threadRobert = {
    id: "thr_002",
    agencyId: AGENCY_ID,
    clientId: "clt_002",
    caregiverId: null,
    topic: "GENERAL",
    subject: "Dad's appetite this week",
    participants: [
      { userId: "fam_002", role: "FAMILY", name: "Maria Velasquez" },
      { userId: "user_admin", role: "AGENCY", name: "Casey Admin" },
    ],
    lastMessageAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
  };
  await db.insert(messageThreadsTable).values([threadEleanor, threadRobert]);
  await db.insert(messagesTable).values([
    {
      id: newId("msg"),
      agencyId: AGENCY_ID,
      threadId: "thr_001",
      authorId: "fam_001",
      authorRole: "FAMILY",
      authorName: "Daniel Park",
      body: "Hi — wanted to check that Aisha is still arriving at 7am. Mom mentioned she felt rushed yesterday.",
      attachments: [],
      readBy: ["fam_001"],
    },
    {
      id: newId("msg"),
      agencyId: AGENCY_ID,
      threadId: "thr_001",
      authorId: "user_admin",
      authorRole: "AGENCY",
      authorName: "Casey Admin",
      body: "Hi Daniel — yes, 7am is the standard start. I'll pass along the feedback so Aisha can pace the morning more gently. Thanks for letting us know.",
      attachments: [],
      readBy: ["user_admin", "fam_001"],
    },
    {
      id: newId("msg"),
      agencyId: AGENCY_ID,
      threadId: "thr_002",
      authorId: "fam_002",
      authorRole: "FAMILY",
      authorName: "Maria Velasquez",
      body: "Dad has been refusing breakfast lately. Should we ask the doctor?",
      attachments: [],
      readBy: ["fam_002"],
    },
  ]);

  // Default notification preferences for family users
  const familyPrefs = familyUsers.flatMap((f) => [
    {
      id: newId("npref"),
      agencyId: AGENCY_ID,
      userId: f.id,
      userRole: "FAMILY",
      notificationTypeId: "visit.incident_reported",
      channels: ["EMAIL", "IN_APP"],
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
      enabled: true,
    },
    {
      id: newId("npref"),
      agencyId: AGENCY_ID,
      userId: f.id,
      userRole: "FAMILY",
      notificationTypeId: "family.visit_summary",
      channels: ["EMAIL"],
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
      enabled: true,
    },
    {
      id: newId("npref"),
      agencyId: AGENCY_ID,
      userId: f.id,
      userRole: "FAMILY",
      notificationTypeId: "messaging.new_message",
      channels: ["IN_APP"],
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
      enabled: true,
    },
  ]);
  await db.insert(notificationPreferencesTable).values(familyPrefs);

  logger.info("Seed complete.");
}

/**
 * Wipe every demo record for the configured agency and rebuild the seed
 * from scratch. Used by the `pnpm demo:reset` command. Idempotent reference
 * rows (notification types, task templates, labor rules) survive because
 * the truncate helper only deletes per-agency demo records and the seed
 * helpers re-insert them with ON CONFLICT DO NOTHING.
 *
 * Boot-time `seed()` short-circuits when client rows exist; this entry
 * point bypasses that guard by truncating first.
 */
export async function seedDemoFresh(): Promise<void> {
  logger.info("Resetting CareOS demo data (truncate + reseed)…");
  await truncateAgencyDemoData();
  await seed();
  logger.info("Demo reset complete.");
}

/**
 * Reference rows for the Phase 2 notification system. Idempotent: safe to
 * re-run on every boot. Uses ON CONFLICT DO NOTHING so existing rows are not
 * disturbed.
 */
async function seedNotificationTypes(): Promise<void> {
  const rows = [
    {
      id: "visit.late_clock_in",
      category: "VISIT",
      label: "Caregiver late clock-in",
      description: "A caregiver did not clock in within the grace window.",
      defaultChannels: ["IN_APP", "PUSH"],
      audienceRoles: ["OWNER", "SCHEDULER"],
    },
    {
      id: "visit.missed",
      category: "VISIT",
      label: "Missed visit",
      description: "A scheduled visit was missed.",
      defaultChannels: ["IN_APP", "PUSH", "SMS"],
      audienceRoles: ["OWNER", "SCHEDULER"],
    },
    {
      id: "visit.incident_reported",
      category: "VISIT",
      label: "Incident reported",
      description: "An incident was logged during a visit.",
      defaultChannels: ["IN_APP", "EMAIL", "PUSH"],
      audienceRoles: ["OWNER", "FAMILY"],
    },
    {
      id: "compliance.auth_expiring",
      category: "COMPLIANCE",
      label: "Authorization expiring",
      description: "A client authorization will expire soon.",
      defaultChannels: ["IN_APP", "EMAIL"],
      audienceRoles: ["OWNER"],
    },
    {
      id: "compliance.document_expiring",
      category: "COMPLIANCE",
      label: "Caregiver document expiring",
      description: "A caregiver document (TB, CPR, etc.) is expiring soon.",
      defaultChannels: ["IN_APP", "EMAIL"],
      audienceRoles: ["OWNER", "CAREGIVER"],
    },
    {
      id: "schedule.shift_offered",
      category: "SCHEDULE",
      label: "Shift offered",
      description: "A new shift has been offered to a caregiver.",
      defaultChannels: ["PUSH", "SMS"],
      audienceRoles: ["CAREGIVER"],
    },
    {
      id: "messaging.new_message",
      category: "MESSAGING",
      label: "New message",
      description: "A new message arrived in one of your threads.",
      defaultChannels: ["IN_APP", "PUSH"],
      audienceRoles: ["OWNER", "CAREGIVER", "FAMILY"],
    },
    {
      id: "family.visit_summary",
      category: "FAMILY",
      label: "Visit summary",
      description: "Summary of a completed visit for family members.",
      defaultChannels: ["EMAIL"],
      audienceRoles: ["FAMILY"],
    },
    {
      id: "visit.reminder_15min",
      category: "VISIT",
      label: "Visit starting soon",
      description: "Caregiver reminder 15 minutes before a scheduled visit.",
      defaultChannels: ["PUSH", "IN_APP"],
      audienceRoles: ["CAREGIVER"],
    },
    {
      id: "visit.verified",
      category: "VISIT",
      label: "Visit verified",
      description: "A caregiver's visit has been approved by the office.",
      defaultChannels: ["PUSH", "IN_APP"],
      audienceRoles: ["CAREGIVER"],
    },
    {
      id: "schedule.changed",
      category: "SCHEDULE",
      label: "Schedule changed",
      description:
        "An assigned shift was rescheduled or reassigned.",
      defaultChannels: ["PUSH", "IN_APP"],
      audienceRoles: ["CAREGIVER"],
    },
    {
      id: "payroll.period_closed",
      category: "PAYROLL",
      label: "Pay period closed",
      description: "A pay period was closed and totals are available.",
      defaultChannels: ["PUSH", "IN_APP", "EMAIL"],
      audienceRoles: ["CAREGIVER"],
    },
  ];
  for (const r of rows) {
    await db.insert(notificationTypesTable).values(r).onConflictDoNothing();
  }
  logger.info({ count: rows.length }, "Seeded notification types.");
}

/**
 * Starter library of care task templates so freshly-bootstrapped care plans
 * have something to pick from.
 */
async function seedTaskTemplates(): Promise<void> {
  const rows: Array<{
    category: string;
    title: string;
    description?: string;
    defaultMinutes: number;
    defaultFrequency: "DAILY" | "WEEKLY" | "PER_VISIT" | "PRN";
    requiresPhoto: number;
  }> = [
    // ADLs
    { category: "ADL", title: "Assist with bathing/showering", description: "Stand-by assist, ensure safety bars used, monitor skin condition.", defaultMinutes: 20, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "ADL", title: "Assist with dressing", description: "Help select weather-appropriate clothing; assist with fasteners.", defaultMinutes: 15, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "ADL", title: "Toileting & incontinence care", description: "Provide privacy, change briefs as needed, perform peri-care.", defaultMinutes: 10, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },
    { category: "ADL", title: "Mobility & transfer assist", description: "Use gait belt; follow PT-recommended transfer technique.", defaultMinutes: 15, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },
    { category: "ADL", title: "Oral hygiene & denture care", defaultMinutes: 10, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "ADL", title: "Hair care & grooming", defaultMinutes: 10, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "ADL", title: "Skin inspection & repositioning", description: "Check pressure points; reposition every 2 hours if bedbound.", defaultMinutes: 10, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },

    // IADLs
    { category: "IADL", title: "Light housekeeping", defaultMinutes: 30, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "IADL", title: "Laundry", defaultMinutes: 45, defaultFrequency: "WEEKLY", requiresPhoto: 0 },
    { category: "IADL", title: "Linen change", defaultMinutes: 20, defaultFrequency: "WEEKLY", requiresPhoto: 0 },
    { category: "IADL", title: "Grocery shopping & errands", defaultMinutes: 60, defaultFrequency: "WEEKLY", requiresPhoto: 0 },
    { category: "IADL", title: "Mail & bill organization", defaultMinutes: 15, defaultFrequency: "WEEKLY", requiresPhoto: 0 },
    { category: "IADL", title: "Pet care assistance", defaultMinutes: 15, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "IADL", title: "Transportation to appointments", defaultMinutes: 90, defaultFrequency: "PRN", requiresPhoto: 0 },

    // Meals & hydration
    { category: "MEAL", title: "Prepare breakfast", defaultMinutes: 25, defaultFrequency: "DAILY", requiresPhoto: 1 },
    { category: "MEAL", title: "Prepare lunch", defaultMinutes: 30, defaultFrequency: "DAILY", requiresPhoto: 1 },
    { category: "MEAL", title: "Prepare dinner", defaultMinutes: 35, defaultFrequency: "DAILY", requiresPhoto: 1 },
    { category: "MEAL", title: "Feeding assistance", description: "Pace bites; monitor for swallowing difficulty.", defaultMinutes: 20, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },
    { category: "MEAL", title: "Hydration check & encouragement", description: "Offer fluids every 1-2h; log intake if requested.", defaultMinutes: 5, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },

    // Medication oversight (non-clinical)
    { category: "MEDICATION", title: "Medication reminder (AM)", description: "Remind client to take pre-poured medications. Do not administer.", defaultMinutes: 5, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "MEDICATION", title: "Medication reminder (PM)", defaultMinutes: 5, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "MEDICATION", title: "Vital signs check (BP/HR)", defaultMinutes: 10, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "MEDICATION", title: "Blood glucose log assist", defaultMinutes: 10, defaultFrequency: "DAILY", requiresPhoto: 0 },

    // Ambulation / exercise
    { category: "AMBULATION", title: "Range-of-motion exercises", defaultMinutes: 15, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "AMBULATION", title: "Walk / outdoor activity", description: "Short supervised walk for endurance; bring walker if prescribed.", defaultMinutes: 30, defaultFrequency: "DAILY", requiresPhoto: 1 },
    { category: "AMBULATION", title: "PT exercise follow-through", defaultMinutes: 20, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },

    // Companionship & cognitive
    { category: "COMPANIONSHIP", title: "Companionship & conversation", defaultMinutes: 30, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },
    { category: "COMPANIONSHIP", title: "Cognitive engagement activity", description: "Puzzle, reading, reminiscence — pick what client enjoys.", defaultMinutes: 20, defaultFrequency: "DAILY", requiresPhoto: 0 },
    { category: "COMPANIONSHIP", title: "Music or video time", defaultMinutes: 20, defaultFrequency: "DAILY", requiresPhoto: 0 },

    // Safety
    { category: "SAFETY", title: "Fall risk environment check", description: "Clear walkways, secure rugs, confirm lighting.", defaultMinutes: 10, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },
    { category: "SAFETY", title: "Emergency call button verification", defaultMinutes: 5, defaultFrequency: "WEEKLY", requiresPhoto: 0 },
    { category: "SAFETY", title: "Wandering precautions check", defaultMinutes: 5, defaultFrequency: "PER_VISIT", requiresPhoto: 0 },
  ];
  for (const r of rows) {
    // Deterministic id: <agency>_<category>_<slug(title)>. Combined with the
    // primary-key conflict target this makes the insert truly idempotent
    // across reboots — no duplicates accumulate.
    const slug = r.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const id = `ttpl_${AGENCY_ID}_${r.category.toLowerCase()}_${slug}`.slice(
      0,
      64,
    );
    await db
      .insert(taskTemplatesTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        category: r.category,
        title: r.title,
        description: r.description ?? null,
        defaultMinutes: r.defaultMinutes,
        defaultFrequency: r.defaultFrequency,
        requiresPhoto: r.requiresPhoto,
      })
      .onConflictDoNothing({ target: taskTemplatesTable.id });
  }
  logger.info({ count: rows.length }, "Seeded task templates.");
}

async function backfillCaregiverPhoneCredentials(): Promise<void> {
  const rows = await db
    .select()
    .from(caregiversTable)
    .where(sql`${caregiversTable.agencyId} = ${AGENCY_ID}`);
  const missing = rows.filter((r) => !r.phoneCode || !r.phonePin);
  if (missing.length === 0) return;
  // Stable, deterministic mapping: index of caregiver in id-sorted order.
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  for (const cg of missing) {
    const idx = ordered.findIndex((r) => r.id === cg.id);
    const code = String(100001 + Math.max(0, idx));
    const pin = cg.phonePin ?? generateIvrPin();
    await db
      .update(caregiversTable)
      .set({
        phoneCode: cg.phoneCode ?? code,
        phonePin: pin,
      })
      .where(sql`${caregiversTable.id} = ${cg.id}`);
    // Never log the PIN; it's auth secret material.
    logger.info(
      { caregiverId: cg.id, phoneCode: cg.phoneCode ?? code },
      "Backfilled IVR phone code (PIN set; must be reset via supervisor flow before use)",
    );
  }
  logger.info({ count: missing.length }, "Backfilled caregiver IVR credentials.");
}

// Generates a 4-digit numeric PIN avoiding the most trivially-guessable
// values (sequential, repeated digits, common defaults). Suitable for IVR
// dev seeding; production agencies should rotate via supervisor reset flow.
function generateIvrPin(): string {
  const blocked = new Set([
    "0000", "1111", "2222", "3333", "4444",
    "5555", "6666", "7777", "8888", "9999",
    "1234", "4321", "0123", "1212", "1010",
    "2580", "0852",
  ]);
  for (let attempts = 0; attempts < 100; attempts++) {
    const n = Math.floor(Math.random() * 10000);
    const pin = String(n).padStart(4, "0");
    if (!blocked.has(pin)) return pin;
  }
  return "8350";
}
