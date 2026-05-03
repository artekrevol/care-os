/**
 * Demo screenshot harness — captures the seven "magic moment" PNGs for the
 * CareOS demo as fallback assets. Drives the live dev stack via Playwright
 * (headless Chromium) hitting the shared proxy at http://localhost:80.
 *
 * Run order:
 *   pnpm demo:reset
 *   pnpm demo:screenshots
 *
 * Outputs land in `demo-assets/`. The script is idempotent — it re-uses any
 * resources it can find (existing referral drafts, in-progress visits) and
 * cleans up only what it created in the same run.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:80";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT_DIR = resolve(ROOT, "demo-assets");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 402, height: 874 };

type Shot = { name: string; ok: boolean; note?: string };
const shots: Shot[] = [];

async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function waitFor(label: string, fn: () => Promise<boolean>, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function snap(page: Page, name: string, note?: string) {
  const file = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ name, ok: true, note });
  console.log(`  ✓ ${name}.png${note ? ` — ${note}` : ""}`);
}

async function settle(page: Page) {
  // Wait for React Query to flush. Avoid networkidle (long-poll/SSE may keep
  // the network bus open). Instead, wait for fonts and a short tick.
  await page.evaluate(
    "document.fonts && document.fonts.ready ? document.fonts.ready : true",
  );
  await page.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// 1) Careos dashboard
// ---------------------------------------------------------------------------
async function shotDashboard(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15_000 });
  await settle(page);
  await snap(page, "01-careos-dashboard");
  await page.close();
}

// ---------------------------------------------------------------------------
// 2) Careos schedule (overtime bars visible)
// ---------------------------------------------------------------------------
async function shotSchedule(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15_000 });
  await settle(page);
  await snap(page, "02-careos-schedule");
  await page.close();
}

// ---------------------------------------------------------------------------
// 3) Careos AI intake (parsed VA referral draft)
// ---------------------------------------------------------------------------
async function shotIntake(ctx: BrowserContext) {
  // Re-use an existing draft if one exists; otherwise upload the VA fixture.
  let drafts = await api<Array<{ id: string; status: string }>>("/api/referral-drafts");
  let draftId = drafts[0]?.id;
  if (!draftId) {
    const pdf = await readFile(
      resolve(ROOT, "artifacts/api-server/test-fixtures/referrals/va-ccn-referral.pdf"),
    );
    const created = await api<{ id: string }>("/api/referral-drafts", {
      method: "POST",
      json: {
        filename: "va-ccn-referral.pdf",
        contentType: "application/pdf",
        contentBase64: pdf.toString("base64"),
      },
    });
    draftId = created.id;
  }
  // Wait for the async parser to populate parsedFields beyond just _filename.
  await waitFor(
    "referral parse",
    async () => {
      const d = await api<{ parsedFields: Record<string, unknown> | null }>(
        `/api/referral-drafts/${draftId}`,
      );
      const keys = Object.keys(d.parsedFields ?? {}).filter((k) => !k.startsWith("_"));
      return keys.length > 0;
    },
    30_000,
  ).catch((e) => console.warn(`  (intake parse not ready: ${(e as Error).message})`));

  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/intake/${draftId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15_000 });
  await settle(page);
  await snap(page, "03-careos-intake-review", `draft ${draftId}`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 4) Caregiver PWA active visit (clock in cg_001 → sch_001)
// ---------------------------------------------------------------------------
async function clockInCg001(): Promise<{ visitId: string; sessionToken: string; expiresAt: string }> {
  const phone = "(415) 555-1101";
  const otp = await api<{ devCode?: string }>("/api/m/auth/request-otp", {
    method: "POST",
    json: { phone },
  });
  if (!otp.devCode) throw new Error("OTP devCode missing — non-prod mode required");
  const verify = await api<{ sessionToken: string; expiresAt: string; caregiverId: string }>(
    "/api/m/auth/verify-otp",
    { method: "POST", json: { phone, code: otp.devCode } },
  );
  // Clock in to sch_001 if not already on a visit
  const clock = await api<{ id: string }>("/api/m/visits/clock-in", {
    method: "POST",
    headers: { authorization: `Bearer ${verify.sessionToken}` },
    json: { scheduleId: "sch_001" },
  });
  return { visitId: clock.id, sessionToken: verify.sessionToken, expiresAt: verify.expiresAt };
}

async function shotCaregiverVisit(
  ctx: BrowserContext,
  session: { visitId: string; sessionToken: string; expiresAt: string },
) {
  const page = await ctx.newPage();
  await page.setViewportSize(MOBILE);
  // Seed session before any caregiver-pwa code runs.
  await page.addInitScript((s) => {
    localStorage.setItem(
      "careos.caregiver.session",
      JSON.stringify({
        sessionToken: s.sessionToken,
        expiresAt: s.expiresAt,
        caregiverId: "cg_001",
      }),
    );
  }, session);
  await page.goto(`${BASE}/m/visit/${session.visitId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main, [data-testid], h1, h2", { timeout: 15_000 });
  await settle(page);
  await snap(page, "04-caregiver-visit", `visit ${session.visitId}`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 5) Family portal Today (clt_001, fam_001)
// ---------------------------------------------------------------------------
async function shotFamilyToday(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(() => {
    localStorage.setItem(
      "careos_family_auth",
      JSON.stringify({ clientId: "clt_001", familyUserId: "fam_001" }),
    );
  });
  await page.goto(`${BASE}/family/today`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15_000 });
  await page
    .waitForFunction(
      `Array.from(document.querySelectorAll("h1")).some((h) => /Today/i.test(h.textContent || ""))`,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await settle(page);
  await snap(page, "05-family-today");
  await page.close();
}

// ---------------------------------------------------------------------------
// 6) Careos payroll period detail
// ---------------------------------------------------------------------------
async function shotPayroll(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/payroll/pp_open`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15_000 });
  await settle(page);
  await snap(page, "06-careos-payroll");
  await page.close();
}

// ---------------------------------------------------------------------------
// 7) Careos compliance
// ---------------------------------------------------------------------------
async function shotCompliance(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/compliance`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15_000 });
  await settle(page);
  await snap(page, "07-careos-compliance");
  await page.close();
}

// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Capturing demo screenshots to ${OUT_DIR}`);
  console.log(`Base URL: ${BASE}`);

  // Verify the stack is up before launching the browser.
  const health = await fetch(`${BASE}/api/healthz`).then((r) => r.ok).catch(() => false);
  if (!health) {
    throw new Error(`API not reachable at ${BASE}/api/healthz — start workflows first.`);
  }

  // Pre-arrange the caregiver-active-visit (this also enables family-portal ON_SITE state).
  let caregiverSession: { visitId: string; sessionToken: string; expiresAt: string } | null = null;
  try {
    caregiverSession = await clockInCg001();
    console.log(`  ↳ caregiver clocked in: visit ${caregiverSession.visitId}`);
  } catch (e) {
    console.warn(`  (caregiver clock-in failed: ${(e as Error).message})`);
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 2,
    });
    // Pin "now" to Tuesday 14:30 PT of the *current* week so views keyed off
    // Date.now() (family-portal Today, careos Schedule "this week") resolve to
    // populated data rather than empty weekend/out-of-range dates.
    //
    // The seed (`seed.ts` / `seed-chajinel.ts`) generates schedules and visits
    // via `dateAt(daysFromMonday, ...)` relative to `new Date()` at seed time,
    // so it always covers the current ISO week. Hard-coding a fixed calendar
    // date would drift after a future `demo:reset`. Computing Tuesday of the
    // real "today" keeps the harness aligned with the seed window.
    //
    // We deliberately override only Date (not performance.now) so framer-motion
    // and other RAF-driven animations still progress past their initial state.
    // Using ctx.clock.install would freeze performance.now and stall those
    // animations, leaving motion.div elements at opacity: 0.
    const FROZEN = (() => {
      const now = new Date();
      const dow = now.getDay(); // 0=Sun..6=Sat
      const daysFromMonday = (dow + 6) % 7; // Mon=0
      const monday = new Date(now);
      monday.setDate(now.getDate() - daysFromMonday);
      // Tuesday 14:30 in local TZ.
      const tue = new Date(monday);
      tue.setDate(monday.getDate() + 1);
      tue.setHours(14, 30, 0, 0);
      return tue.valueOf();
    })();
    console.log(`  ↳ frozen "now" = ${new Date(FROZEN).toISOString()}`);
    await ctx.addInitScript(`(() => {
      const FROZEN = ${FROZEN};
      const _Date = Date;
      function PatchedDate(...args) {
        if (!(this instanceof PatchedDate)) {
          return new _Date(FROZEN).toString();
        }
        const inst = args.length === 0 ? new _Date(FROZEN) : new _Date(...args);
        Object.setPrototypeOf(inst, PatchedDate.prototype);
        return inst;
      }
      PatchedDate.prototype = Object.create(_Date.prototype);
      PatchedDate.prototype.constructor = PatchedDate;
      Object.setPrototypeOf(PatchedDate, _Date);
      PatchedDate.now = () => FROZEN;
      PatchedDate.parse = _Date.parse.bind(_Date);
      PatchedDate.UTC = _Date.UTC.bind(_Date);
      // @ts-ignore
      globalThis.Date = PatchedDate;
    })();`);

    await shotDashboard(ctx);
    await shotSchedule(ctx);
    await shotIntake(ctx);
    if (caregiverSession) {
      await shotCaregiverVisit(ctx, caregiverSession);
    } else {
      shots.push({ name: "04-caregiver-visit", ok: false, note: "skipped: no clock-in" });
    }
    await shotFamilyToday(ctx);
    await shotPayroll(ctx);
    await shotCompliance(ctx);

    await ctx.close();
  } finally {
    if (browser) await browser.close();
  }

  const manifest = {
    capturedAt: new Date().toISOString(),
    baseUrl: BASE,
    shots,
  };
  await writeFile(resolve(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  const failed = shots.filter((s) => !s.ok);
  console.log(`\n${shots.length - failed.length}/${shots.length} screenshots captured.`);
  if (failed.length) {
    console.log("Failed:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("demo:screenshots failed:", err);
  process.exit(1);
});
