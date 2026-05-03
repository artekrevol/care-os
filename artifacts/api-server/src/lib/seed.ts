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
} from "@workspace/db";
import { AGENCY_ID } from "./agency";
import { newId } from "./ids";
import { logger } from "./logger";

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

export async function seed(): Promise<void> {
  // Phase 2 reference rows are idempotent (ON CONFLICT DO NOTHING) and need
  // to run on every boot so newly added types/templates land without a wipe.
  await seedNotificationTypes();
  await seedTaskTemplates();

  // Skip Phase 1 demo data if already seeded.
  const existing = await db
    .select()
    .from(clientsTable)
    .where(sql`${clientsTable.agencyId} = ${AGENCY_ID}`)
    .limit(1);
  if (existing.length > 0) {
    logger.info("Seed skipped — data already present.");
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
  await db.insert(laborRuleSetsTable).values([ruleCA, ruleFLSA, ruleNY, ruleTX]);

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
      status: "ACTIVE",
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
      primaryPayer: "MEDICAID_HCBS",
      status: "ACTIVE",
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
      status: "ACTIVE",
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
      primaryPayer: "LTC_INSURANCE",
      status: "ACTIVE",
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
      firstName: "Aisha",
      lastName: "Johnson",
      email: "aisha.j@careos.demo",
      phone: "(415) 555-1101",
      employmentType: "W2",
      hireDate: isoDateNDaysFromNow(-720),
      status: "ACTIVE",
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
      status: "ACTIVE",
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
      status: "ACTIVE",
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
      employmentType: "1099",
      hireDate: isoDateNDaysFromNow(-90),
      status: "ACTIVE",
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
      status: "ACTIVE",
      languages: ["English", "Spanish"],
      skills: ["Hoyer lift", "Wound care", "Insulin support"],
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
      status: "INACTIVE",
      languages: ["English", "Hindi", "Gujarati"],
      skills: ["Companion care", "Medication reminders"],
      payRate: "22.50",
      hasVehicle: true,
      addressCity: "Fremont",
      addressState: "CA",
    },
  ].map((c) => ({ ...c, agencyId: AGENCY_ID }));
  await db.insert(caregiversTable).values(caregivers);

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

  logger.info("Seed complete.");
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
  const rows = [
    { category: "ADL", title: "Assist with bathing", defaultMinutes: 20, requiresPhoto: 0 },
    { category: "ADL", title: "Assist with dressing", defaultMinutes: 15, requiresPhoto: 0 },
    { category: "ADL", title: "Toileting & incontinence care", defaultMinutes: 10, requiresPhoto: 0 },
    { category: "ADL", title: "Mobility & transfer assist", defaultMinutes: 15, requiresPhoto: 0 },
    { category: "MEAL", title: "Prepare meal", defaultMinutes: 30, requiresPhoto: 1 },
    { category: "MEAL", title: "Feeding assistance", defaultMinutes: 20, requiresPhoto: 0 },
    { category: "MEAL", title: "Hydration check", defaultMinutes: 5, requiresPhoto: 0 },
    { category: "MEDICATION", title: "Medication reminder", defaultMinutes: 5, requiresPhoto: 0 },
    { category: "MEDICATION", title: "Vital signs check", defaultMinutes: 10, requiresPhoto: 0 },
    { category: "HOUSEKEEPING", title: "Light housekeeping", defaultMinutes: 30, requiresPhoto: 0 },
    { category: "HOUSEKEEPING", title: "Laundry", defaultMinutes: 45, requiresPhoto: 0 },
    { category: "COMPANIONSHIP", title: "Companionship & conversation", defaultMinutes: 30, requiresPhoto: 0 },
    { category: "COMPANIONSHIP", title: "Cognitive engagement activity", defaultMinutes: 20, requiresPhoto: 0 },
    { category: "EXERCISE", title: "Range-of-motion exercises", defaultMinutes: 15, requiresPhoto: 0 },
    { category: "EXERCISE", title: "Walk / outdoor activity", defaultMinutes: 30, requiresPhoto: 1 },
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
        defaultMinutes: r.defaultMinutes,
        requiresPhoto: r.requiresPhoto,
      })
      .onConflictDoNothing({ target: taskTemplatesTable.id });
  }
  logger.info({ count: rows.length }, "Seeded task templates.");
}
