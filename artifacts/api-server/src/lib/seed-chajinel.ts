/**
 * Phase 2.5 — Chajinel Home Care expansion seed.
 *
 * The core `seed()` in seed.ts establishes 6 anchor caregivers and 6 anchor
 * clients carrying every magic-moment record (Eleanor's expiring VA auth,
 * Aisha's projected OT, Marco's expired background check, Linh's geofence
 * mismatch, the anomaly long-hours visit, the BEHAVIOR incident, etc).
 *
 * This module appends additional realistic records on top of the anchors so
 * the demo reflects a 32-caregiver, 24-client California agency:
 *   - 26 additional caregivers across LA / OC / SB counties with the Spanish
 *     / Tagalog / Vietnamese language mix described in the Phase 2.5 spec.
 *   - 18 additional clients, primarily VA Community Care veterans (70+).
 *   - One authorization per new client (mostly fresh; 3 expiring < 30 days,
 *     1 expired-but-still-being-worked).
 *   - Schedules across the current week with realistic coverage gaps.
 *   - 4 weeks of historical visits at ~96% verified.
 *   - A FALL incident magic moment (severity HIGH) with supervisor notes.
 *   - A LOW renewal-likelihood prediction stored as an agent_run plus a
 *     companion compliance alert so the renewal-risk panel has data.
 *   - Caregiver documents (background check, TB, CPR, I9) per new caregiver.
 *
 * Idempotency: this function assumes core seed already ran and the database
 * was empty for the agency. Callers must NOT invoke this twice without a
 * truncate; see `seedDemoFresh()` in seed.ts for the supported reset path.
 */
import { sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  caregiversTable,
  authorizationsTable,
  caregiverDocumentsTable,
  schedulesTable,
  visitsTable,
  complianceAlertsTable,
  visitIncidentsTable,
  agentRunsTable,
  carePlansTable,
} from "@workspace/db";
import { AGENCY_ID } from "./agency";
import { newId } from "./ids";
import { logger } from "./logger";


function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function dateAt(daysFromMonday: number, hour: number, minute = 0): Date {
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

// Deterministic-ish RNG so seeded data is stable run-to-run; uses a basic
// linear congruential generator seeded from index so tests are repeatable.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

type ExpCaregiver = {
  id: string;
  firstName: string;
  lastName: string;
  languages: string[];
  certs: string[]; // e.g. ["CNA"], ["CHHA"], []
  city: string;
  county: "LA" | "OC" | "SB";
  lat: number;
  lng: number;
  payRate: string;
  hireDaysAgo: number;
};

// 26 expansion caregivers covering Spanish (16) / Tagalog (6) / Vietnamese
// (3) / English-only (1) so combined with the 6 anchor caregivers the agency
// hits the Phase 2.5 distribution of 18 Spanish, 6 Tagalog, 4 Vietnamese,
// and 4 English-only. Credential mix on the expansion side: 9 CNA, 11 CHHA,
// 6 unlicensed; combined with anchor caregivers (1 CNA, 1 CHHA, 4 misc) the
// total is close to the requested 10/12/10 split without forcing anchors.
const EXPANSION_CAREGIVERS: ExpCaregiver[] = [
  // Spanish-speaking caregivers (16)
  { id: "cg_007", firstName: "Maria", lastName: "Hernandez", languages: ["Spanish", "English"], certs: ["CNA"], city: "Long Beach", county: "LA", lat: 33.770, lng: -118.193, payRate: "23.50", hireDaysAgo: 540 },
  { id: "cg_008", firstName: "Jose", lastName: "Ramirez", languages: ["Spanish", "English"], certs: ["CHHA"], city: "Anaheim", county: "OC", lat: 33.836, lng: -117.914, payRate: "22.00", hireDaysAgo: 280 },
  { id: "cg_009", firstName: "Guadalupe", lastName: "Castillo", languages: ["Spanish"], certs: ["CHHA"], city: "Santa Ana", county: "OC", lat: 33.745, lng: -117.867, payRate: "22.50", hireDaysAgo: 410 },
  { id: "cg_010", firstName: "Carlos", lastName: "Mendoza", languages: ["Spanish", "English"], certs: ["CNA"], city: "Pomona", county: "LA", lat: 34.055, lng: -117.752, payRate: "24.00", hireDaysAgo: 650 },
  { id: "cg_011", firstName: "Luz", lastName: "Vargas", languages: ["Spanish"], certs: [], city: "Riverside", county: "SB", lat: 33.953, lng: -117.396, payRate: "21.00", hireDaysAgo: 95 },
  { id: "cg_012", firstName: "Roberto", lastName: "Salinas", languages: ["Spanish", "English"], certs: ["CHHA"], city: "San Bernardino", county: "SB", lat: 34.108, lng: -117.290, payRate: "22.50", hireDaysAgo: 360 },
  { id: "cg_013", firstName: "Esperanza", lastName: "Cruz", languages: ["Spanish"], certs: ["CNA"], city: "Compton", county: "LA", lat: 33.895, lng: -118.220, payRate: "23.75", hireDaysAgo: 800 },
  { id: "cg_014", firstName: "Miguel", lastName: "Torres", languages: ["Spanish", "English"], certs: ["CHHA"], city: "Fontana", county: "SB", lat: 34.092, lng: -117.435, payRate: "22.25", hireDaysAgo: 175 },
  { id: "cg_015", firstName: "Rosa", lastName: "Aguilar", languages: ["Spanish"], certs: ["CHHA"], city: "Garden Grove", county: "OC", lat: 33.774, lng: -117.937, payRate: "22.00", hireDaysAgo: 220 },
  { id: "cg_016", firstName: "Luis", lastName: "Reyes", languages: ["Spanish", "English"], certs: ["CNA"], city: "El Monte", county: "LA", lat: 34.068, lng: -118.027, payRate: "24.25", hireDaysAgo: 470 },
  { id: "cg_017", firstName: "Ana", lastName: "Flores", languages: ["Spanish"], certs: [], city: "Ontario", county: "SB", lat: 34.063, lng: -117.650, payRate: "21.25", hireDaysAgo: 60 },
  { id: "cg_018", firstName: "Pedro", lastName: "Gutierrez", languages: ["Spanish", "English"], certs: ["CHHA"], city: "Whittier", county: "LA", lat: 33.979, lng: -118.032, payRate: "22.75", hireDaysAgo: 330 },
  { id: "cg_019", firstName: "Carmen", lastName: "Ortiz", languages: ["Spanish"], certs: ["CNA"], city: "Westminster", county: "OC", lat: 33.751, lng: -117.993, payRate: "23.50", hireDaysAgo: 600 },
  { id: "cg_020", firstName: "Antonio", lastName: "Diaz", languages: ["Spanish", "English"], certs: ["CHHA"], city: "Pico Rivera", county: "LA", lat: 33.983, lng: -118.096, payRate: "22.50", hireDaysAgo: 250 },
  { id: "cg_021", firstName: "Patricia", lastName: "Morales", languages: ["Spanish"], certs: [], city: "Rancho Cucamonga", county: "SB", lat: 34.106, lng: -117.591, payRate: "21.50", hireDaysAgo: 110 },
  { id: "cg_022", firstName: "Javier", lastName: "Lopez", languages: ["Spanish", "English"], certs: ["CNA"], city: "Norwalk", county: "LA", lat: 33.902, lng: -118.082, payRate: "24.00", hireDaysAgo: 720 },

  // Tagalog-speaking caregivers (6)
  { id: "cg_023", firstName: "Imelda", lastName: "Santos", languages: ["Tagalog", "English"], certs: ["CNA"], city: "Carson", county: "LA", lat: 33.831, lng: -118.281, payRate: "24.50", hireDaysAgo: 540 },
  { id: "cg_024", firstName: "Ramil", lastName: "Aquino", languages: ["Tagalog", "English"], certs: ["CHHA"], city: "Cerritos", county: "LA", lat: 33.858, lng: -118.064, payRate: "23.00", hireDaysAgo: 290 },
  { id: "cg_025", firstName: "Maricel", lastName: "Bautista", languages: ["Tagalog", "English"], certs: ["CHHA"], city: "Eagle Rock", county: "LA", lat: 34.139, lng: -118.207, payRate: "22.75", hireDaysAgo: 180 },
  { id: "cg_026", firstName: "Jonathan", lastName: "Cruz", languages: ["Tagalog", "English"], certs: ["CNA"], city: "West Covina", county: "LA", lat: 34.068, lng: -117.939, payRate: "24.25", hireDaysAgo: 430 },
  { id: "cg_027", firstName: "Lourdes", lastName: "Reyes", languages: ["Tagalog", "English"], certs: [], city: "Glendora", county: "LA", lat: 34.136, lng: -117.865, payRate: "21.75", hireDaysAgo: 75 },
  { id: "cg_028", firstName: "Ferdinand", lastName: "Garcia", languages: ["Tagalog", "English"], certs: ["CHHA"], city: "Fullerton", county: "OC", lat: 33.870, lng: -117.925, payRate: "23.25", hireDaysAgo: 380 },

  // Vietnamese-speaking caregivers (3 — combined with anchor cg_003 = 4)
  { id: "cg_029", firstName: "Thuy", lastName: "Pham", languages: ["Vietnamese", "English"], certs: ["CNA"], city: "Westminster", county: "OC", lat: 33.756, lng: -117.989, payRate: "24.00", hireDaysAgo: 510 },
  { id: "cg_030", firstName: "Hoang", lastName: "Tran", languages: ["Vietnamese"], certs: ["CHHA"], city: "Garden Grove", county: "OC", lat: 33.772, lng: -117.946, payRate: "22.50", hireDaysAgo: 200 },
  { id: "cg_031", firstName: "Mai", lastName: "Le", languages: ["Vietnamese", "English"], certs: [], city: "Anaheim", county: "OC", lat: 33.840, lng: -117.900, payRate: "21.50", hireDaysAgo: 80 },

  // Additional English-only (1 — combined with anchor cg_001/cg_004 = 3, plus
  // cg_006 inactive Hindi puts overall English mix at 4 once we count
  // English+other multilinguals as primary-other).
  { id: "cg_032", firstName: "Ashley", lastName: "Brennan", languages: ["English"], certs: ["CHHA"], city: "Newport Beach", county: "OC", lat: 33.620, lng: -117.928, payRate: "23.50", hireDaysAgo: 320 },
];

type ExpClient = {
  id: string;
  firstName: string;
  lastName: string;
  dob: string; // 70+ veterans where payer = VA_CCN
  payer: "VA_CCN" | "COUNTY_IHSS" | "PRIVATE_PAY";
  authNumber: string;
  authIssuedDaysAgo: number;
  authExpiresInDays: number; // negative = expired
  approvedHoursPerWeek: string;
  city: string;
  postalCode: string;
  lat: number;
  lng: number;
  languages: string[];
  notes?: string;
};

// 18 expansion clients: 17 VA Community Care veterans + 1 county/IHSS to
// round out the spec target. Phase 1 already supplies 1 VA CCN, 1 IHSS, 2
// private pay, 1 LTC, 1 Medicaid (plus expired auth on the VA client) —
// combined the agency carries 18 VA veterans, 4 IHSS-style, 2 private pay
// dominant.
const EXPANSION_CLIENTS: ExpClient[] = [
  // Most-fresh authorizations (issued recently, expire many months out).
  { id: "clt_007", firstName: "Harold", lastName: "Bishop", dob: "1948-03-21", payer: "VA_CCN", authNumber: "VA-2026-09812", authIssuedDaysAgo: 30, authExpiresInDays: 335, approvedHoursPerWeek: "20.00", city: "Long Beach", postalCode: "90802", lat: 33.768, lng: -118.190, languages: ["English"], notes: "Vietnam veteran. Mild COPD." },
  { id: "clt_008", firstName: "Reginald", lastName: "Foster", dob: "1944-07-09", payer: "VA_CCN", authNumber: "VA-2026-09844", authIssuedDaysAgo: 45, authExpiresInDays: 320, approvedHoursPerWeek: "16.00", city: "Anaheim", postalCode: "92805", lat: 33.835, lng: -117.913, languages: ["English"], notes: "Korea-era veteran. Hearing aid." },
  { id: "clt_009", firstName: "Beatriz", lastName: "Cordova", dob: "1947-11-30", payer: "VA_CCN", authNumber: "VA-2026-09851", authIssuedDaysAgo: 22, authExpiresInDays: 343, approvedHoursPerWeek: "24.00", city: "Santa Ana", postalCode: "92701", lat: 33.746, lng: -117.867, languages: ["Spanish", "English"], notes: "Spouse benefit. Spanish-preferred." },
  { id: "clt_010", firstName: "Walter", lastName: "Greene", dob: "1942-05-12", payer: "VA_CCN", authNumber: "VA-2026-09903", authIssuedDaysAgo: 60, authExpiresInDays: 305, approvedHoursPerWeek: "30.00", city: "San Bernardino", postalCode: "92408", lat: 34.103, lng: -117.290, languages: ["English"], notes: "Vietnam veteran. CHF stable." },
  { id: "clt_011", firstName: "Ernesto", lastName: "Padilla", dob: "1949-08-04", payer: "VA_CCN", authNumber: "VA-2026-09917", authIssuedDaysAgo: 18, authExpiresInDays: 347, approvedHoursPerWeek: "20.00", city: "Pomona", postalCode: "91767", lat: 34.057, lng: -117.749, languages: ["Spanish", "English"], notes: "Spouse-of-veteran benefit." },
  { id: "clt_012", firstName: "Doris", lastName: "Whitlock", dob: "1946-02-18", payer: "VA_CCN", authNumber: "VA-2026-09928", authIssuedDaysAgo: 35, authExpiresInDays: 330, approvedHoursPerWeek: "18.00", city: "Rialto", postalCode: "92376", lat: 34.106, lng: -117.370, languages: ["English"], notes: "Vietnam-era veteran widow." },
  { id: "clt_013", firstName: "Salvador", lastName: "Ibarra", dob: "1945-12-01", payer: "VA_CCN", authNumber: "VA-2026-09945", authIssuedDaysAgo: 75, authExpiresInDays: 290, approvedHoursPerWeek: "22.00", city: "Whittier", postalCode: "90602", lat: 33.978, lng: -118.030, languages: ["Spanish", "English"] },
  { id: "clt_014", firstName: "Dolores", lastName: "Quintero", dob: "1950-04-22", payer: "VA_CCN", authNumber: "VA-2026-09971", authIssuedDaysAgo: 50, authExpiresInDays: 315, approvedHoursPerWeek: "16.00", city: "Norwalk", postalCode: "90650", lat: 33.902, lng: -118.080, languages: ["Spanish"] },
  { id: "clt_015", firstName: "Frank", lastName: "Donovan", dob: "1941-10-06", payer: "VA_CCN", authNumber: "VA-2026-09989", authIssuedDaysAgo: 12, authExpiresInDays: 353, approvedHoursPerWeek: "30.00", city: "Newport Beach", postalCode: "92660", lat: 33.620, lng: -117.928, languages: ["English"], notes: "Korean War veteran. Recent fall." },
  { id: "clt_016", firstName: "Linda", lastName: "Whitfield", dob: "1948-09-19", payer: "VA_CCN", authNumber: "VA-2026-10002", authIssuedDaysAgo: 28, authExpiresInDays: 337, approvedHoursPerWeek: "20.00", city: "Garden Grove", postalCode: "92840", lat: 33.774, lng: -117.937, languages: ["English"] },
  { id: "clt_017", firstName: "Tomas", lastName: "Vega", dob: "1943-06-25", payer: "VA_CCN", authNumber: "VA-2026-10018", authIssuedDaysAgo: 85, authExpiresInDays: 280, approvedHoursPerWeek: "18.00", city: "Fontana", postalCode: "92335", lat: 34.092, lng: -117.435, languages: ["Spanish", "English"], notes: "Diabetic, monitors BG twice daily." },
  { id: "clt_018", firstName: "Helen", lastName: "Carrington", dob: "1947-01-15", payer: "VA_CCN", authNumber: "VA-2026-10024", authIssuedDaysAgo: 40, authExpiresInDays: 325, approvedHoursPerWeek: "20.00", city: "Cerritos", postalCode: "90703", lat: 33.858, lng: -118.064, languages: ["English"] },

  // Three expiring under 30 days — to feed the renewal-pipeline panel.
  { id: "clt_019", firstName: "Manuel", lastName: "Acosta", dob: "1944-03-08", payer: "VA_CCN", authNumber: "VA-2025-04488", authIssuedDaysAgo: 340, authExpiresInDays: 12, approvedHoursPerWeek: "20.00", city: "El Monte", postalCode: "91731", lat: 34.068, lng: -118.027, languages: ["Spanish", "English"], notes: "Vietnam veteran. Renewal packet pending CCN response." },
  { id: "clt_020", firstName: "Patricia", lastName: "Holloway", dob: "1946-11-11", payer: "VA_CCN", authNumber: "VA-2025-04501", authIssuedDaysAgo: 350, authExpiresInDays: 22, approvedHoursPerWeek: "16.00", city: "Westminster", postalCode: "92683", lat: 33.751, lng: -117.993, languages: ["English"] },
  { id: "clt_021", firstName: "Vicente", lastName: "Rojas", dob: "1942-12-02", payer: "VA_CCN", authNumber: "VA-2025-04555", authIssuedDaysAgo: 360, authExpiresInDays: 5, approvedHoursPerWeek: "24.00", city: "Carson", postalCode: "90745", lat: 33.831, lng: -118.281, languages: ["Spanish", "English"], notes: "Critical: lapses in 5 days. Renewal packet faxed twice, no CCN reply." },

  // One expired but service continuing under appeal (auth_chajinel_expired).
  { id: "clt_022", firstName: "Alfred", lastName: "Sumner", dob: "1943-04-17", payer: "VA_CCN", authNumber: "VA-2025-04201", authIssuedDaysAgo: 380, authExpiresInDays: -7, approvedHoursPerWeek: "20.00", city: "West Covina", postalCode: "91790", lat: 34.068, lng: -117.939, languages: ["English"], notes: "Service continuing under VA appeal — caregiver still scheduled." },

  // One county/IHSS to round mix.
  { id: "clt_023", firstName: "Concepcion", lastName: "Mejia", dob: "1952-08-30", payer: "COUNTY_IHSS", authNumber: "IHSS-LA-44218", authIssuedDaysAgo: 90, authExpiresInDays: 275, approvedHoursPerWeek: "12.00", city: "Compton", postalCode: "90220", lat: 33.895, lng: -118.220, languages: ["Spanish"] },

  // One additional VA veteran client to total 18 expansion records.
  { id: "clt_024", firstName: "Charles", lastName: "Whitman", dob: "1940-02-09", payer: "VA_CCN", authNumber: "VA-2026-10101", authIssuedDaysAgo: 14, authExpiresInDays: 351, approvedHoursPerWeek: "22.00", city: "Fullerton", postalCode: "92831", lat: 33.870, lng: -117.925, languages: ["English"], notes: "Korea veteran, hospice-curious but stable." },
];

// Round-robin assignment of expansion clients to expansion caregivers,
// preferring caregivers in the same county and matching language. Falls back
// to round-robin when no match exists.
function assignClientToCaregiver(client: ExpClient, idx: number): string {
  const counties: Record<string, "LA" | "OC" | "SB"> = {
    "Long Beach": "LA", "Compton": "LA", "Carson": "LA", "Norwalk": "LA",
    "Whittier": "LA", "Pico Rivera": "LA", "El Monte": "LA",
    "West Covina": "LA", "Cerritos": "LA", "Eagle Rock": "LA",
    "Glendora": "LA",
    "Anaheim": "OC", "Santa Ana": "OC", "Garden Grove": "OC",
    "Westminster": "OC", "Newport Beach": "OC", "Fullerton": "OC",
    "Pomona": "LA",
    "Riverside": "SB", "San Bernardino": "SB", "Fontana": "SB",
    "Ontario": "SB", "Rancho Cucamonga": "SB",
  };
  const targetCounty = counties[client.city] ?? "LA";
  const langPref = client.languages[0];
  const eligible = EXPANSION_CAREGIVERS.filter(
    (cg) => cg.county === targetCounty && cg.languages.includes(langPref),
  );
  const pool =
    eligible.length > 0
      ? eligible
      : EXPANSION_CAREGIVERS.filter((cg) => cg.languages.includes(langPref));
  const final = pool.length > 0 ? pool : EXPANSION_CAREGIVERS;
  return final[idx % final.length]!.id;
}

export async function seedChajinelExpansion(): Promise<void> {
  logger.info("Seeding Chajinel expansion (Phase 2.5)…");

  // 1) Caregivers
  const caregiverRows = EXPANSION_CAREGIVERS.map((cg, i) => ({
    id: cg.id,
    agencyId: AGENCY_ID,
    userId: null,
    firstName: cg.firstName,
    lastName: cg.lastName,
    email: `${cg.firstName.toLowerCase()}.${cg.lastName.toLowerCase()}@chajinel.demo`,
    phone: `(${[323, 562, 626, 657, 714, 909, 949][i % 7]}) 555-${String(2000 + i).padStart(4, "0")}`,
    employmentType: "W2",
    hireDate: isoDate(-cg.hireDaysAgo),
    status: "APPROVED",
    languages: cg.languages,
    skills: cg.certs.length > 0 ? ["Personal care", "Meal prep"] : ["Companion care"],
    payRate: cg.payRate,
    hasVehicle: i % 4 !== 0,
    addressCity: cg.city,
    addressState: "CA",
    homeLat: String(cg.lat),
    homeLng: String(cg.lng),
    pwaInstalled: i % 3 !== 0,
    phoneCode: String(200001 + i),
    phonePin: String(2001 + i).padStart(4, "0"),
    compatibilityTags: cg.languages.includes("Spanish") ? ["spanish-speaking"] : cg.languages.includes("Tagalog") ? ["tagalog-speaking"] : cg.languages.includes("Vietnamese") ? ["vietnamese-speaking"] : [],
    certifications: cg.certs,
    preferredRadiusMiles: "15.0",
    ratingAverage: (4.3 + (i % 5) * 0.1).toFixed(2),
  }));
  await db.insert(caregiversTable).values(caregiverRows);

  // 2) Caregiver documents — every expansion caregiver gets a baseline kit.
  // Most fresh, a few near-expiring to populate compliance dashboards.
  const docs: (typeof caregiverDocumentsTable.$inferInsert)[] = [];
  EXPANSION_CAREGIVERS.forEach((cg, i) => {
    docs.push({
      id: newId("doc"),
      agencyId: AGENCY_ID,
      caregiverId: cg.id,
      documentType: "BACKGROUND_CHECK",
      issuedDate: isoDate(-Math.min(cg.hireDaysAgo + 7, 720)),
      expirationDate: isoDate(720 - Math.min(cg.hireDaysAgo, 700)),
      fileUrl: null,
    });
    docs.push({
      id: newId("doc"),
      agencyId: AGENCY_ID,
      caregiverId: cg.id,
      documentType: "TB_TEST",
      issuedDate: isoDate(-(i % 200 + 30)),
      expirationDate: isoDate(365 - (i % 200 + 30)),
      fileUrl: null,
    });
    docs.push({
      id: newId("doc"),
      agencyId: AGENCY_ID,
      caregiverId: cg.id,
      documentType: "CPR",
      issuedDate: isoDate(-(i % 600 + 30)),
      expirationDate: i % 8 === 0 ? isoDate(20) : isoDate(700 - (i % 600 + 30)),
      fileUrl: null,
    });
    docs.push({
      id: newId("doc"),
      agencyId: AGENCY_ID,
      caregiverId: cg.id,
      documentType: "I9",
      issuedDate: isoDate(-cg.hireDaysAgo),
      expirationDate: null,
      fileUrl: null,
    });
    if (cg.certs.includes("CNA")) {
      docs.push({
        id: newId("doc"),
        agencyId: AGENCY_ID,
        caregiverId: cg.id,
        documentType: "CNA_LICENSE",
        issuedDate: isoDate(-Math.min(cg.hireDaysAgo, 720)),
        expirationDate: isoDate(720),
        fileUrl: null,
      });
    }
  });
  await db.insert(caregiverDocumentsTable).values(docs);

  // 3) Clients
  const clientRows = EXPANSION_CLIENTS.map((c) => ({
    id: c.id,
    agencyId: AGENCY_ID,
    firstName: c.firstName,
    lastName: c.lastName,
    dob: c.dob,
    phone: `(${["310", "562", "626", "657", "714", "909", "949"][EXPANSION_CLIENTS.indexOf(c) % 7]}) 555-${String(3000 + EXPANSION_CLIENTS.indexOf(c)).padStart(4, "0")}`,
    email: null,
    addressLine1: `${100 + EXPANSION_CLIENTS.indexOf(c) * 7} Main St`,
    city: c.city,
    state: "CA",
    postalCode: c.postalCode,
    primaryPayer: c.payer,
    status: c.authExpiresInDays < 0 ? "ON_HOLD" : "ACTIVE",
    intakeDate: isoDate(-c.authIssuedDaysAgo - 14),
    languages: c.languages,
    carePreferences: c.notes ?? "Standard daily-living support.",
    allergies: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    homeLat: String(c.lat),
    homeLng: String(c.lng),
    geofenceRadiusMeters: "150",
    riskTier: c.authExpiresInDays < 0 ? "HIGH" : "STANDARD",
    fallRisk: c.notes?.toLowerCase().includes("fall") ? "HIGH" : null,
    cognitiveStatus: null,
    familyPortalEnabled: false,
  }));
  await db.insert(clientsTable).values(clientRows);

  // 4) Authorizations — one per expansion client.
  const authRows = EXPANSION_CLIENTS.map((c, i) => ({
    id: `auth_chajinel_${String(i + 1).padStart(3, "0")}`,
    agencyId: AGENCY_ID,
    clientId: c.id,
    payer: c.payer,
    authNumber: c.authNumber,
    issuedDate: isoDate(-c.authIssuedDaysAgo),
    expirationDate: isoDate(c.authExpiresInDays),
    approvedHoursPerWeek: c.approvedHoursPerWeek,
    approvedHoursTotal: String(parseFloat(c.approvedHoursPerWeek) * 52),
    hoursUsed: String(
      parseFloat(c.approvedHoursPerWeek) *
        Math.max(1, Math.floor(c.authIssuedDaysAgo / 7) - 2),
    ),
    scopeOfCare: c.payer === "VA_CCN"
      ? ["Personal care", "Meal prep", "Medication reminders", "Companionship"]
      : ["Personal care", "Light housekeeping"],
    documentUrl: null,
  }));
  await db.insert(authorizationsTable).values(authRows);

  // 4b) Approved care plans — one per expansion client. ADL/IADL task lists
  // vary by payer profile so VA Community Care veterans get personal-care
  // heavy plans and IHSS / private pay get a leaner mix. Authored & approved
  // ~30 days before each auth issued so the timeline reads naturally.
  const carePlanRows = EXPANSION_CLIENTS.map((c, i) => {
    const isVeteran = c.payer === "VA_CCN";
    const tasks = isVeteran
      ? [
          { id: "t1", title: "Bathing & grooming assist", category: "ADL", frequency: "Daily", defaultMinutes: 25 },
          { id: "t2", title: "Mobility & transfer support", category: "ADL", frequency: "Daily", defaultMinutes: 15 },
          { id: "t3", title: "Medication reminders", category: "MEDICATION", frequency: "Daily 8:00 & 18:00", defaultMinutes: 5 },
          { id: "t4", title: "Meal prep (heart-healthy)", category: "MEAL", frequency: "Daily", defaultMinutes: 30 },
          { id: "t5", title: "Light housekeeping", category: "HOUSEKEEPING", frequency: "Mon/Wed/Fri", defaultMinutes: 30 },
          { id: "t6", title: "Companionship & wellness check", category: "COMPANIONSHIP", frequency: "Daily", defaultMinutes: 30 },
        ]
      : c.payer === "PRIVATE_PAY"
        ? [
            { id: "t1", title: "Personal care assist", category: "ADL", frequency: "Daily", defaultMinutes: 20 },
            { id: "t2", title: "Errands & transportation", category: "IADL", frequency: "Tue/Thu", defaultMinutes: 60 },
            { id: "t3", title: "Light housekeeping", category: "HOUSEKEEPING", frequency: "Weekly", defaultMinutes: 45 },
            { id: "t4", title: "Companionship", category: "COMPANIONSHIP", frequency: "Daily", defaultMinutes: 45 },
          ]
        : [
            { id: "t1", title: "Bathing assist", category: "ADL", frequency: "Mon/Wed/Fri", defaultMinutes: 25 },
            { id: "t2", title: "Meal prep", category: "MEAL", frequency: "Daily", defaultMinutes: 25 },
            { id: "t3", title: "Light housekeeping", category: "HOUSEKEEPING", frequency: "Weekly", defaultMinutes: 45 },
            { id: "t4", title: "Companion check-in", category: "COMPANIONSHIP", frequency: "Daily", defaultMinutes: 20 },
          ];
    const goals = isVeteran
      ? [
          { id: "g1", title: "Maintain independence in home" },
          { id: "g2", title: "Avoid hospital readmission" },
          { id: "g3", title: "Stay socially engaged" },
        ]
      : [
          { id: "g1", title: "Support safe daily living at home" },
          { id: "g2", title: "Maintain personal hygiene & nutrition" },
        ];
    const riskFactors: string[] = [];
    if (c.notes?.toLowerCase().includes("copd")) riskFactors.push("COPD — monitor breathing");
    if (c.notes?.toLowerCase().includes("chf")) riskFactors.push("CHF — track weight/swelling");
    if (c.notes?.toLowerCase().includes("diabet")) riskFactors.push("Diabetes — BG checks");
    if (c.notes?.toLowerCase().includes("fall")) riskFactors.push("Recent fall — high fall risk");
    if (c.notes?.toLowerCase().includes("hearing")) riskFactors.push("Hard of hearing");
    const preferences: Record<string, string> = {};
    if (c.languages.includes("Spanish") && !c.languages.includes("English")) {
      preferences.languagePreference = "Spanish-only";
    } else if (c.languages.includes("Spanish")) {
      preferences.languagePreference = "Spanish-preferred";
    }
    const issuedDaysAgo = c.authIssuedDaysAgo + 30;
    return {
      id: `cp_chajinel_${String(i + 1).padStart(3, "0")}`,
      agencyId: AGENCY_ID,
      clientId: c.id,
      version: 1,
      status: "APPROVED",
      title: `${c.firstName} ${c.lastName} — Care Plan`,
      goals: goals as never,
      tasks: tasks as never,
      riskFactors: riskFactors as never,
      preferences: preferences as never,
      effectiveStart: new Date(Date.now() - issuedDaysAgo * 24 * 60 * 60 * 1000),
      authoredBy: "user_admin",
      approvedBy: "user_admin",
      approvedAt: new Date(Date.now() - (issuedDaysAgo - 2) * 24 * 60 * 60 * 1000),
    };
  });
  await db.insert(carePlansTable).values(carePlanRows);

  // 5) Schedules — current week, primary caregiver per client. Skip 5
  // clients to leave 70%+ assigned coverage with realistic open shifts.
  const assignments = EXPANSION_CLIENTS.map((c, i) => ({
    client: c,
    caregiverId: assignClientToCaregiver(c, i),
    skip: [3, 7, 11, 14, 17].includes(i), // ~5 unassigned to look real
  }));
  const scheduleRows: (typeof schedulesTable.$inferInsert)[] = [];
  let schedSeq = 100;
  assignments.forEach(({ client, caregiverId, skip }, i) => {
    if (skip) return;
    const authId = `auth_chajinel_${String(i + 1).padStart(3, "0")}`;
    const hoursPerVisit = parseFloat(client.approvedHoursPerWeek) >= 24 ? 6 : 4;
    const visitsPerWeek = Math.min(
      5,
      Math.max(2, Math.round(parseFloat(client.approvedHoursPerWeek) / hoursPerVisit)),
    );
    // Rotate through M/W/F or T/Th/Sat patterns based on index.
    const pattern = i % 2 === 0 ? [0, 2, 4, 1, 3] : [1, 3, 0, 2, 4];
    for (let v = 0; v < visitsPerWeek; v++) {
      const day = pattern[v]!;
      const startH = 8 + (v % 2) * 5; // 8am or 1pm
      const endH = startH + hoursPerVisit;
      const start = dateAt(day, startH);
      const end = dateAt(day, endH);
      scheduleRows.push({
        id: `sch_chj_${String(schedSeq++).padStart(4, "0")}`,
        agencyId: AGENCY_ID,
        clientId: client.id,
        caregiverId,
        authorizationId: authId,
        startTime: start,
        endTime: end,
        scheduledMinutes: hoursPerVisit * 60,
        serviceCode: "G0156",
        serviceDescription: "Home health aide services",
        status: "SCHEDULED",
        notes: null,
      });
    }
  });
  await db.insert(schedulesTable).values(scheduleRows);

  // 6) Visit history — past 4 weeks, ~96% verified. Generate 1 visit per
  // assigned client per active week-day pattern. Each visit is independent
  // from the schedules above so we don't violate FK constraints.
  const visitRows: (typeof visitsTable.$inferInsert)[] = [];
  const rng = lcg(42);
  assignments.forEach(({ client, caregiverId, skip }, i) => {
    if (skip) return;
    const cgRow = EXPANSION_CAREGIVERS.find((c) => c.id === caregiverId);
    const hoursPerVisit = parseFloat(client.approvedHoursPerWeek) >= 24 ? 6 : 4;
    const pattern = i % 2 === 0 ? [0, 2, 4] : [1, 3];
    for (let weekOffset = -4; weekOffset <= -1; weekOffset++) {
      for (const dayOfWeek of pattern) {
        const start = dateAt(weekOffset * 7 + dayOfWeek, 8 + (i % 3) * 2);
        const end = new Date(start.getTime() + hoursPerVisit * 3600 * 1000);
        // 4% exception/pending rate.
        const roll = rng();
        const verified = roll > 0.04;
        const jitterLat = (rng() - 0.5) * 0.0008;
        const jitterLng = (rng() - 0.5) * 0.0008;
        visitRows.push({
          id: newId("vis"),
          agencyId: AGENCY_ID,
          scheduleId: null,
          caregiverId,
          clientId: client.id,
          clockInTime: start,
          clockInLat: String((client.lat + jitterLat).toFixed(6)),
          clockInLng: String((client.lng + jitterLng).toFixed(6)),
          clockInMethod: cgRow?.county === "SB" && rng() > 0.7 ? "PHONE" : "GPS",
          clockOutTime: end,
          clockOutLat: String((client.lat + jitterLat).toFixed(6)),
          clockOutLng: String((client.lng + jitterLng).toFixed(6)),
          clockOutMethod: "GPS",
          durationMinutes: hoursPerVisit * 60,
          tasksCompleted: ["Personal care", "Meal prep", "Medication reminders"],
          caregiverNotes: "Routine visit completed.",
          supervisorNotes: null,
          verificationStatus: verified ? "VERIFIED" : (roll > 0.02 ? "PENDING" : "EXCEPTION"),
          exceptionReason: !verified && roll < 0.02 ? "Manual review pending" : null,
          geoFenceMatch: true,
        });
      }
    }
  });
  await db.insert(visitsTable).values(visitRows);

  // 7) Magic moment: caregiver-reported FALL incident (HIGH severity) on
  // Frank Donovan (clt_015). Pick the most-recent VERIFIED visit for him
  // and attach the incident to it; create an OPEN compliance alert so it
  // shows up on the dashboard.
  const frankVisits = visitRows.filter((v) => v.clientId === "clt_015");
  const frankIncidentVisit = frankVisits.length > 0 ? frankVisits[frankVisits.length - 1]! : null;
  if (frankIncidentVisit) {
    await db.insert(visitIncidentsTable).values({
      id: newId("inc"),
      agencyId: AGENCY_ID,
      visitId: frankIncidentVisit.id,
      reportedBy: frankIncidentVisit.caregiverId,
      severity: "HIGH",
      category: "FALL",
      description:
        "Mr. Donovan slipped while transferring from chair to walker. Caught him before he hit the floor. No visible injury but he reported left hip soreness. Family notified; recommended urgent care visit.",
      photoUrls: [],
    });
    await db.insert(complianceAlertsTable).values({
      id: newId("alert"),
      agencyId: AGENCY_ID,
      alertType: "INCIDENT_REPORTED",
      severity: "HIGH",
      entityType: "Client",
      entityId: "clt_015",
      title: "Fall incident reported for Frank Donovan",
      message:
        "Caregiver caught Mr. Donovan during chair-to-walker transfer. Hip soreness reported, no visible injury. Family notified.",
      suggestedAction:
        "Confirm urgent care follow-up; review fall-risk care plan and consider PT referral.",
      status: "OPEN",
    });
  }

  // 8) Magic moment: LOW renewal-likelihood prediction for Vicente Rojas
  // (clt_021), the auth expiring in 5 days. Stored as an agent_run so the
  // intelligence dashboard has a real record to render, plus a CRITICAL
  // compliance alert that links back to the run.
  const renewalRunId = newId("ar");
  await db.insert(agentRunsTable).values({
    id: renewalRunId,
    agencyId: AGENCY_ID,
    agentName: "auth_renewal_predictor",
    promptVersion: "v1.0.0",
    model: "claude-sonnet-4-5",
    status: "COMPLETED",
    triggeredBy: "system_scheduler",
    triggerReason: "Daily renewal-risk sweep",
    inputRef: null,
    inputSummary:
      "Authorization VA-2025-04555 (Vicente Rojas) expires in 5 days. Prior renewal pattern: 2 prior auths, both required >2 follow-ups before VA CCN response. Current renewal packet faxed twice in past 14 days with no response.",
    outputRef: null,
    outputSummary:
      "LOW renewal likelihood (0.18). VA CCN response delays observed on prior cycles, no acknowledgement returned for current packet. Recommend escalation to Community Care Network case manager and contingency to bridge with private-pay until reauthorization confirmed.",
    confidence: "0.180",
    latencyMs: 4120,
    inputTokens: 1840,
    outputTokens: 612,
    costUsd: "0.014280",
    metadata: {
      authorizationId: "auth_chajinel_015",
      clientId: "clt_021",
      predictedClass: "LOW",
      escalationRecommended: true,
    } as never,
    completedAt: new Date(Date.now() - 6 * 3600 * 1000),
  });
  await db.insert(complianceAlertsTable).values({
    id: newId("alert"),
    agencyId: AGENCY_ID,
    alertType: "RENEWAL_RISK",
    severity: "CRITICAL",
    entityType: "Authorization",
    entityId: "auth_chajinel_015",
    title: "Vicente Rojas authorization predicted unlikely to renew on time",
    message:
      "AI renewal predictor (confidence 0.18 LOW). VA CCN has not responded to two faxed renewal packets. Auth expires in 5 days.",
    suggestedAction:
      "Escalate to VA Community Care Network case manager today; line up private-pay bridge agreement with the family.",
    agentRunId: renewalRunId,
    status: "OPEN",
  });

  // 9) Magic moment: demo VA referral PDF — already copied to
  // intake/uploads/demo-va-referral.pdf at the filesystem level. We seed an
  // OPEN intake-style alert so the demo flow has a clear pointer to it.
  await db.insert(complianceAlertsTable).values({
    id: newId("alert"),
    agencyId: AGENCY_ID,
    alertType: "REFERRAL_PENDING",
    severity: "MEDIUM",
    entityType: "Referral",
    entityId: "demo-va-referral.pdf",
    title: "New VA Community Care referral awaiting intake",
    message:
      "Referral PDF queued at intake/uploads/demo-va-referral.pdf. Run AI Intake parser to extract veteran demographics and authorization details.",
    suggestedAction:
      "Open the AI Intake page and select 'Process VA Community Care Referral' to parse and create a draft client.",
    status: "OPEN",
  });

  logger.info(
    {
      caregivers: caregiverRows.length,
      clients: clientRows.length,
      authorizations: authRows.length,
      schedules: scheduleRows.length,
      visits: visitRows.length,
    },
    "Chajinel expansion seed complete.",
  );
}

/**
 * Truncate every demo table for the agency in FK-safe order. Used by the
 * `pnpm demo:reset` command so a stale demo can be wiped and reseeded
 * without dropping the database. Reference rows (notification types, task
 * templates, labor rules) are preserved because they are idempotent and
 * shared agency-wide.
 */
export async function truncateAgencyDemoData(): Promise<void> {
  // Order matters: child tables before parents. Anything not listed is
  // expected to be reference data or empty in the demo agency.
  const stmts = [
    sql`DELETE FROM messages WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM message_threads WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM notification_log WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM notification_preferences WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM push_subscriptions WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM visit_checklist_instances WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM visit_incidents WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM visit_notes WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM visit_signatures WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM visits WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM time_entries WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM schedules WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM care_plan_acknowledgments WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM care_plans WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM family_users WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM caregiver_documents WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM client_documents WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM auth_renewal_predictions WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM authorizations WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM compliance_alerts WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM referral_drafts WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM audit_log WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM agent_runs WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM compatibility_scores WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM anomaly_events WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM pay_periods WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM caregiver_otp_codes WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM caregiver_sessions WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM caregiver_credentials WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM caregivers WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM task_templates WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM clients WHERE agency_id = ${AGENCY_ID}`,
    sql`DELETE FROM labor_rule_sets WHERE agency_id = ${AGENCY_ID}`,
  ];
  for (const s of stmts) {
    try {
      await db.execute(s);
    } catch (e) {
      // Only tolerate "relation does not exist" (older schemas / dropped
      // tables). Anything else (locks, FK violations, perms) is a real
      // problem that must abort the reset so we don't silently leave
      // stale/partial demo data behind.
      const err = e as { code?: string; message?: string };
      if (err.code === "42P01") {
        logger.warn(
          { err: err.message },
          "Skipping missing table during demo reset (relation does not exist)",
        );
        continue;
      }
      throw e;
    }
  }
}
