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
  // Wait for OT projection + active labor rule to render (no skeleton).
  await page.waitForFunction(
    `(() => {
      const t = document.body.innerText || "";
      return /Active Clients/i.test(t) && /Active Caregivers/i.test(t) && /Projected OT/i.test(t);
    })()`,
    null,
    { timeout: 15_000 },
  );
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
  // Hard assertion: schedule grid must show the expected day-of-week headers
  // and at least one shift card before we capture.
  await page.waitForFunction(
    `(() => {
      const text = document.body.innerText || "";
      const hasGrid = /Mon,\\s*\\d|Tue,\\s*\\d|Wed,\\s*\\d/.test(text);
      const hasShift = /SCHEDULED|IN_PROGRESS|COMPLETED/.test(text);
      return hasGrid && hasShift;
    })()`,
    null,
    { timeout: 15_000 },
  );
  // Hover over the first scheduled shift card so the OT-impact tooltip /
  // hover affordance is visible — the "drag-drop schedule grid mid-hover"
  // moment called for in the task brief.
  const firstShift = page.locator('[class*="cursor-grab"], [data-shift-id], [class*="shift-card"]').first();
  if (await firstShift.count()) {
    await firstShift.hover().catch(() => {});
  }
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
  // Hard-fail (no .catch) so we never capture a pre-extraction skeleton —
  // confidence scores must be visible per the task brief.
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
  );

  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/intake/${draftId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15_000 });
  // Confirm at least one confidence score is rendered (e.g. "97%", "91%")
  // before capture; otherwise the screenshot would miss the magic-moment.
  await page.waitForFunction(
    `/(^|[^\\d])\\d{2,3}%/.test(document.body.innerText || "")`,
    null,
    { timeout: 15_000 },
  );
  await settle(page);
  await snap(page, "03-careos-intake-review", `draft ${draftId}`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 4) Caregiver PWA active visit (clock in cg_001 → sch_001)
// ---------------------------------------------------------------------------
async function clockInCg001(occurredAtIso: string): Promise<{ visitId: string; sessionToken: string; expiresAt: string }> {
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
  // Pass occurredAt aligned to FROZEN so the clocked-in visit row falls
  // inside the family-portal Today window (queried under FROZEN's date).
  const clock = await api<{ id: string }>("/api/m/visits/clock-in", {
    method: "POST",
    headers: { authorization: `Bearer ${verify.sessionToken}` },
    json: { scheduleId: "sch_001", occurredAt: occurredAtIso },
  });
  return { visitId: clock.id, sessionToken: verify.sessionToken, expiresAt: verify.expiresAt };
}

function computeFrozenMs(): number {
  // Mid-shift inside sch_001 (Mon 07:00–16:00 UTC) so visit is in-progress.
  // Using UTC explicitly (seed's dateAt also uses UTC) avoids host-TZ drift.
  const now = new Date();
  const dow = now.getUTCDay();
  const daysFromMonday = (dow + 6) % 7;
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday,
    11, 0, 0, 0, // 11:00 UTC = squarely inside 07:00–16:00 UTC sch_001 window
  ));
  return monday.getTime();
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
  // Assert the active-visit checklist is rendered (client name + at least one
  // care-plan task + clock-out CTA) before capture.
  await page.waitForFunction(
    `(() => {
      const t = document.body.innerText || "";
      return /Eleanor Park/i.test(t) && /On site|En route|Clocked in/i.test(t) && /Clock out/i.test(t);
    })()`,
    null,
    { timeout: 15_000 },
  );
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
  // Hard-assert: heading rendered AND a real status card is visible (not the
  // loading skeleton or empty-state placeholder). Fail the run if neither
  // populated state appears.
  // Hard-assert ON_SITE state with caregiver and arrival time visible.
  // We pre-clocked-in cg_001 against sch_001 and FROZEN is mid-shift, so
  // family-portal Today must resolve to "Caregiver On Site". Fail fast if
  // it lands on Scheduled/Complete/empty — the previous shot was wrong.
  await page.waitForFunction(
    `(() => {
      const t = document.body.innerText || "";
      if (!/Today's Care/i.test(t)) return false;
      if (!/Caregiver On Site/i.test(t)) return false;
      if (!/Arrived At/i.test(t)) return false;
      return true;
    })()`,
    null,
    { timeout: 20_000 },
  );
  await settle(page);
  await snap(page, "05-family-today", "ON SITE");
  await page.close();
}

// ---------------------------------------------------------------------------
// 6) Careos payroll period detail
// ---------------------------------------------------------------------------
async function shotPayroll(ctx: BrowserContext) {
  // Close pp_prev (Apr 13-26) so it has computed entries with regular/OT
  // hour breakdowns. The harness is idempotent — if it's already closed
  // the API returns 400 and we proceed to capture.
  let target = "pp_prev";
  try {
    await api(`/api/pay-periods/${target}/close`, { method: "POST", json: {} });
  } catch (e) {
    const msg = (e as Error).message;
    if (!/already CLOSED|already FINALIZED/i.test(msg)) {
      console.warn(`  (close ${target} failed: ${msg.slice(0, 200)}; falling back to pp_open)`);
      target = "pp_open";
    }
  }
  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/payroll/${target}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15_000 });
  // Hard-assert the OT calculation breakdown is rendered: Caregiver Summary
  // table populated and at least one non-zero overtime hour value present.
  await page.waitForFunction(
    `(() => {
      const t = document.body.innerText || "";
      if (!/Pay Period Details/i.test(t)) return false;
      if (!/Caregiver Summary/i.test(t)) return false;
      // Either an OT hours value > 0 anywhere, or "Overtime" label paired
      // with a non-zero numeric in the totals row.
      return /\\bOT\\b|Overtime/i.test(t) && /[1-9][0-9]*\\.[0-9]+\\s*h|[1-9][0-9]*\\s*h/.test(t);
    })()`,
    null,
    { timeout: 20_000 },
  );
  await settle(page);
  await snap(page, "06-careos-payroll", `period ${target}`);
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
  // Require at least 2 OPEN alert cards before capturing so we never grab an
  // empty list state.
  await page.waitForFunction(
    `(document.body.innerText || "").match(/OPEN/g)?.length >= 2`,
    null,
    { timeout: 15_000 },
  );
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

  // FROZEN_MS computed in UTC so the clocked-in visit row's clockInTime
  // falls inside the family-portal Today window (which is also queried under
  // FROZEN). See computeFrozenMs() for the rationale.
  const FROZEN_MS = computeFrozenMs();
  console.log(`  ↳ frozen "now" = ${new Date(FROZEN_MS).toISOString()}`);

  // Pre-arrange the caregiver-active-visit (this also enables family-portal ON_SITE state).
  let caregiverSession: { visitId: string; sessionToken: string; expiresAt: string } | null = null;
  try {
    caregiverSession = await clockInCg001(new Date(FROZEN_MS).toISOString());
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
      timezoneId: "America/Los_Angeles",
      locale: "en-US",
    });
    // We deliberately override only Date (not performance.now) so framer-motion
    // and other RAF-driven animations still progress past their initial state.
    // Using ctx.clock.install would freeze performance.now and stall those
    // animations, leaving motion.div elements at opacity: 0.
    await ctx.addInitScript(`(() => {
      const FROZEN = ${FROZEN_MS};
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
