# CareOS

Multi-tenant home care operations platform MVP. Single-agency demo (`agency_demo`) with multi-tenant-ready data model.

## Architecture

- **`artifacts/careos`** — React + Vite frontend (TanStack Query, shadcn/ui, wouter)
- **`artifacts/api-server`** — Express API server, mounted at `/api`
- **`lib/db`** — Drizzle ORM + Postgres (schema-per-table under `lib/db/src/schema/*`)
- **`lib/api-spec`** — OpenAPI source of truth → codegen via `pnpm --filter @workspace/api-spec run codegen`
- **`lib/api-zod`** — Generated Zod schemas (server-side validation)
- **`lib/api-client-react`** — Generated TanStack Query hooks (frontend)

## Modules

1. **Clients** — intake, profile, authorizations (with payer, hours, expiration tracking)
2. **Caregivers** — onboarding, documents (background check, TB, CPR, I9), expiration alerts
3. **Schedule** — weekly visit assignment, conflict detection
4. **Visits / EVV** — clock-in/out with GPS, geofence/duration exception flags, supervisor verification
5. **Payroll** — pay periods, time entries, OT/DT calculation through the labor rule engine, CSV export
6. **Labor Rules** — configurable rule sets per state (CA, NY, TX, FLSA federal). The active rule is applied during pay-period close.
7. **Compliance** — auto-generated alerts (auth expiring, doc expired, geo mismatch, OT threshold, missed visit)
8. **Audit Log** — every meaningful mutation is recorded with actor, action, summary, before/after state

## Labor Rule Engine

Located in `artifacts/api-server/src/lib/laborRuleEngine.ts`.

For a given week of work days per caregiver, applies in order:

1. **Daily double-time threshold** — minutes over `dtDailyMinutes` flip to DT (CA: 720 min / 12h)
2. **Daily overtime threshold** — minutes over `otDailyMinutes` flip to OT (CA: 540 min / 9h for domestic workers)
3. **Weekly overtime threshold** — running regular minutes over `otWeeklyMinutes` flip to OT (federal: 2400 min / 40h; NY: 2640 min / 44h)
4. **Seventh-day consecutive rule** — if the caregiver worked 7 consecutive days, the seventh day's first 8h flip to OT and rest to DT (CA only)

Each computed entry is stamped with `${state}-${version}` (e.g. `CA-2026.1`) so historical pay records always show under which rule version they were calculated.

## Key Conventions

- All IDs are prefixed strings (`clt_*`, `cg_*`, `sch_*`, `vis_*`, `auth_*`, `pp_*`, `te_*`, `aud_*`, `alert_*`, `doc_*`, `rule_*`)
- Drizzle `numeric` columns return as strings → coerce with `Number()` before arithmetic; cast to `String()` when inserting
- Drizzle `date` columns return as `YYYY-MM-DD` strings; `timestamp` columns return as `Date`
- Single-tenant constant `AGENCY_ID = "agency_demo"` is applied to every read/write
- Audit log entries are recorded inline in route handlers via `recordAudit({ action, entityType, entityId, summary, ... })`
- Visit verification statuses: `PENDING` → (`VERIFIED` | `REJECTED`); auto-flagged `EXCEPTION` if duration < 30 min

## Seed

`artifacts/api-server/src/lib/seed.ts` runs idempotently on server start. Creates 4 labor rule sets (CA active), 6 clients, 6 caregivers, 5 authorizations, 19 caregiver documents (with mixed expiration states), ~21 schedules for the current week, ~40 verified historical visits + 3 current pending/exception visits, 2 pay periods, 6 compliance alerts, and 5 audit entries.

## Routes

All under `/api`. See `artifacts/api-server/src/routes/` — files are sliced by domain matching the OpenAPI tag groups. The barrel `routes/index.ts` mounts every router on the shared root.

## Phase 2 Foundation

Phase 2 introduces shared infrastructure for AI agents, real-time collaboration, family portal, messaging, push notifications, and route optimization. All services degrade gracefully when their env vars are absent — the API still boots, and a startup report is logged listing which services are enabled vs disabled.

### `lib/services` (`@workspace/services`)

Submodule entry points (import from `@workspace/services/<name>`):

- `queue` — BullMQ + ioredis; queues only created when Redis is reachable
- `ai` — Anthropic SDK wrapper (used by `recordAgentRun` cost calc)
- `ocr` — AWS Textract document analysis
- `realtime` — Pusher server-side trigger
- `storage` — Replit Object Storage with HMAC-signed pre-signed upload/read URL helpers (`getPresignedUploadUrl`, `getPresignedReadUrl`, `verifySignedUrl`). The Replit SDK lacks native signed URLs, so these tokens are validated by companion api-server routes that proxy bytes to/from the bucket (route implementation lands in a follow-up slice).
- `notifications` — Resend (email) + Twilio (SMS) + web-push (push) fan-out
- `maps` — Google Distance Matrix with `drive_time_cache` read-through and haversine fallback

Server startup calls `logServiceStartupReport()` to print the enabled/disabled matrix.

### Phase 2 schema additions (`lib/db/src/schema`)

New tables: `care_plans`, `task_templates`, `visit_checklist_instances`, `visit_notes`, `visit_incidents`, `visit_signatures`, `family_users`, `message_threads`, `messages`, `notification_types`, `notification_preferences`, `notification_log`, `push_subscriptions`, `agent_runs`, `drive_time_cache`, `compatibility_scores`, `anomaly_events`, `auth_renewal_predictions`, `referral_drafts`.

Extended tables:
- `clients` — `homeLat/Lng`, `geofenceRadius`, `riskTier`, `fallRisk`, `cognitiveStatus`, `familyPortalEnabled`, `activeCarePlanId`
- `caregivers` — `userId`, `pwaInstalled`, `lastSeenAt`, `compatibilityTags`, `certifications`, `preferredRadiusMiles`, `ratingAverage`
- `visits` — `carePlanId`, `carePlanVersion`, `riskScore`, `anomalyFlags`, `offlineSyncedAt`, `clientSignatureId`, `hasIncident`
- `schedules` — `recurrenceRule`, `parentScheduleId`, `travelMinutesEstimate`, `optimizationRunId`

### Agent run audit

`artifacts/api-server/src/lib/agentRun.ts` provides `startAgentRun` / `completeAgentRun` / `failAgentRun` / `recordAgentRun`. Inputs/outputs are uploaded to object storage; the row stores token counts and an estimated USD cost (Anthropic pricing for Sonnet/Haiku).

### BullBoard

Mounted at `/admin/jobs` (registered in `artifacts/api-server/.replit-artifact/artifact.toml` `services.paths`) behind `ownerGuard`. Auth: `Authorization: Bearer ${ADMIN_BEARER_TOKEN}` is honored in any environment when the env var is set; `X-CareOS-Role: OWNER` is honored only in non-production as a dev convenience. Without either credential the route returns `401`. When no Redis is configured the route returns `503` instead of failing to boot.

### PWA scaffolding

`artifacts/careos/public/manifest.webmanifest` and `sw.js` are placeholders (empty install/activate/fetch/push handlers) wired into `index.html` via `<link rel="manifest">` and Apple/theme meta tags. Service worker registration logic for offline visits ships in a later phase.

### Demo screenshots (fallback assets)

`pnpm demo:screenshots` runs a headless Playwright harness
(`scripts/src/demo-screenshots.ts`) against the local stack and writes
seven canonical "magic moment" PNGs to `demo-assets/`. The PNGs and
`manifest.json` are committed as the baseline fallback set; only `*.tmp`
under that directory is gitignored. The harness clocks in cg_001 via
OTP, seeds caregiver-pwa session + family-portal localStorage auth, and
freezes Date to Monday 11:00 UTC of the current week (mid-shift inside
sch_001) so seed-relative schedules populate and the just-clocked-in
visit row falls inside the family-portal Today query window. It also
closes pp_prev so the payroll capture shows the OT calculation
breakdown. It does NOT freeze `performance.now()` (which would stall
framer-motion animations at opacity:0). Recommended workflow:
`demo:reset` then `demo:screenshots`. See `demo-assets/README.md`.

### Environment variables (Phase 2)

All of these are optional — missing values disable the corresponding service and log a warning at startup. Set them via the Secrets pane (never write them to code).

| Service           | Variables |
|-------------------|-----------|
| Queue (BullMQ)    | `UPSTASH_REDIS_URL` |
| AI (Anthropic)    | `ANTHROPIC_API_KEY` |
| OCR (Textract)    | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| Realtime (Pusher) | `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` |
| Object Storage    | `REPLIT_OBJECT_STORE_BUCKET_ID`, `STORAGE_URL_SIGNING_SECRET` (HMAC key for pre-signed upload/read URLs; falls back to a per-process random secret in dev) |
| Email (Resend)    | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| SMS (Twilio)      | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Web Push          | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Maps              | `GOOGLE_MAPS_API_KEY` |
| Admin             | `ADMIN_BEARER_TOKEN` (alternative to the `X-CareOS-Role: OWNER` header for `/admin/jobs`) |

### Phase 2.5 hardening — System Health & AI Run Inspection (Task #36)

In-process service-status tracker at `lib/services/src/health/index.ts`
maintains a 24h ring buffer per module (ai, ocr, queue, realtime, storage,
maps, notifications.email/sms/push) recording success timestamps and the
last-50 errors. Each service module exports a `probe()` function (and the
notifications module exports `probeEmail/probeSms/probePush`); probes call
`recordSuccess`/`recordError` automatically.

Owner-only routes (mounted in `routes/index.ts`):

| Route | Purpose |
|-------|---------|
| `GET /api/admin/system-health` | per-service status + per-queue depths |
| `POST /api/admin/system-health/:module/probe` | run a live probe (audited) |
| `POST /api/admin/queues/:name/failed/retry-all?limit=200` | bulk retry DLQ (audited) |
| `POST /api/admin/queues/:name/failed/discard-all?limit=200` | bulk discard DLQ (audited) |
| `GET /api/agent-runs?status[]=…&from=&to=&agentName=&limit=&offset=` | filter + paginate; `LOW_CONFIDENCE` is a virtual status |
| `GET /api/agent-runs/cost-summary?range=24h\|7d\|30d` | cost-by-agent rollup |
| `POST /api/agent-runs/:id/retry` | re-trigger via `AGENT_RUNNERS`; queue-only agents return ok=false with a BullBoard hint |

UI: new `/admin/system-health` page in careos with status cards, "Test
connection" probe buttons, and per-queue Retry/Discard actions. The
`/agent-runs` page gained filter chips (SUCCEEDED/FAILED/TIMEOUT/LOW_CONFIDENCE),
agent + datetime filters, a cost-rollup card, a detail drawer, and per-row
Retry. Both pages reuse the locally stored Admin token (same key as
BullBoard).

DLQ depth alert: `artifacts/api-server/src/lib/dlqWatch.ts` runs every 5
minutes via `setInterval` in `startWorkers()`. When any known queue's
failed-job count exceeds `DLQ_ALERT_THRESHOLD` (default 10), it emails each
address in `OWNER_EMAILS` (comma-separated) using `notifications.sendDirectEmail`,
debounced 1h per queue in-memory. Uses `setInterval` (not BullMQ repeat) so
the alert still fires when Redis itself is the failing dependency.

## Task #38 — Critical-path automated tests

Vitest is wired at the root (`pnpm test`) with a single `vitest.config.ts`
that picks up tests from `lib/services/src/**/*.test.ts` and
`artifacts/api-server/src/**/*.test.ts`. Three suites currently ship:

- `lib/services/src/labor/__tests__/laborRules.test.ts` — eight pure-unit
  cases for the labor rule engine: CA daily OT, CA double-time, CA 7-day
  consecutive, FLSA weekly (45h), FLSA mixed (50h with a 14h day), NY 44h
  residential threshold, TX FLSA-only, plus a CA pay-math regression guard.
- `artifacts/api-server/src/__tests__/ivr.integration.test.ts` — five IVR
  security cases hitting the live api-server: spoofed caller-ID + valid
  PIN signs in, 3 wrong PINs in one call hangs up, 5 wrong PINs lock the
  caregiver, 8 wrong PINs lock the From number, and a unit-level check
  that `validateTwilioSignature` returns `"invalid"` for a malformed sig
  (the live 403 path can't be exercised because dev mode runs without
  `TWILIO_AUTH_TOKEN`). The 5-PIN test targets cg_006 because the route's
  caregiver-locked pre-check only fires for real seeded caregivers; cg_006
  will be locked in api-server memory until the lockout window expires.
- `artifacts/api-server/src/__tests__/multiTenant.test.ts` — single-tenant
  invariant guard. The codebase uses `AGENCY_ID = "agency_demo"` as a
  hard-coded constant; full cross-tenant isolation tests are blocked
  until per-request agency derivation lands.

Drift from the original Task #38 spec:
- Cross-tenant isolation tests with three seeded agencies + a Drizzle
  unscoped-query throw are deferred — the codebase is single-agency.
- Authorization drawdown race test is deferred — `hoursUsed` is read for
  validation but never atomically incremented in any route, so there is
  no race to test until transactional drawdown lands.
- Caregiver PWA offline visit lifecycle Playwright test is deferred —
  Playwright is not installed and the PWA's offline queue would need a
  test harness on top of the dev server.

## Task #39 — Performance & concurrency tuning

### Database indexes

Every agency-scoped table now has composite indexes for the hot-path query
patterns (agency+status, agency+FK, agency+timestamp). Defined in each Drizzle
schema file's third-argument callback (same pattern as `webhookLogs.ts`).

Index audit — FK columns covered:

| Table | Index columns | Hot-path query |
|-------|---------------|----------------|
| `schedules` | (agencyId, status), (agencyId, startTime), (agencyId, caregiverId), (agencyId, clientId), (caregiverId, startTime), (authorizationId) | List by date range, caregiver schedule lookup, auth linkage |
| `visits` | (agencyId, verificationStatus), (agencyId, clockInTime), (agencyId, caregiverId), (agencyId, clientId), (scheduleId), (agencyId, createdAt) | Dashboard counts, visit list filters, schedule linkage |
| `clients` | (agencyId, status) | Active client count, list filter |
| `caregivers` | (agencyId, status), (userId) | Active caregiver count, auth lookup by userId |
| `compliance_alerts` | (agencyId, status), (entityType, entityId), (agencyId, dedupeKey, status) | Dashboard open-alert count, upsertAlert dedupe |
| `authorizations` | (agencyId, clientId), (agencyId, expirationDate) | Client auth lookup, expiring-soon scan |
| `agent_runs` | (agencyId, status), (agencyId, startedAt) | Admin run list, date-range filter |
| `audit_log` | (agencyId, timestamp) | Recent activity feed |
| `time_entries` | (agencyId, payPeriodId), (agencyId, caregiverId), (visitId) | Pay-period totals, caregiver pay lookup |
| `care_plans` | (agencyId, clientId), (agencyId, status) | Client care plan lookup |
| `caregiver_documents` | (agencyId, caregiverId) | Document list by caregiver |
| `pay_periods` | (agencyId, status), (agencyId, startDate) | Period list ordered by date |

### N+1 elimination

Batch-lookup pattern replaces per-row DB calls in list endpoints:

- **`schedules.ts`** — `batchFormat()` pre-loads all clients+caregivers via
  `inArray`, maps from in-memory cache. Single-row `format()` delegates to it.
- **`visits.ts`** — identical `batchFormatVisits()` pattern.
- **`dashboard.ts`** — 11 sequential queries replaced with a single
  `Promise.all()` that fires all count/select queries concurrently.
- **`family.ts`** — client summary pre-loads caregivers, visit notes, and
  incidents in 3 batch queries instead of 3 per visit.
- **`payPeriods.ts`** — list endpoint fetches all time entries for all periods
  in one `inArray` query instead of one per period.

### BullMQ per-queue concurrency

`QUEUE_CONCURRENCY` map in `lib/services/src/queue/index.ts` sets explicit
concurrency for every queue name. `registerWorker` reads it (default 1).

| Queue | Concurrency | Rationale |
|-------|-------------|-----------|
| `notification.send` | 10 | I/O-bound fan-out to email/SMS/push providers |
| `visit.reminder-15min` | 5 | Time-sensitive, I/O-bound |
| `drive-time.refresh` | 3 | External API calls (Google Maps) |
| `care-plan.generate`, `schedule.optimize`, `schedule.suggest-caregivers`, `ocr.extract-document`, `ai.intake-referral` | 2 | Moderate parallelism for AI/compute tasks |
| `anomaly.scan-visit`, `anomaly.scan-all`, `auth.predict-renewal`, `auth.predict-renewals-all`, `compliance.daily-scan`, `pay-period.auto-close` | 1 | Serialized to avoid resource contention; scan-all and predict-all are batch-scoped |

### Pusher channel lifecycle

Pusher is only used in `artifacts/caregiver-pwa/src/pages/Messages.tsx` for
real-time message delivery on a per-thread private channel. The channel is
created inside a `useEffect` that returns a cleanup function calling
`ch.unbind()`, `client.unsubscribe()`, and `client.disconnect()`. When the
caregiver navigates away from the Messages page (including logout, which
calls `onLogout()` and unmounts all page components), React's effect cleanup
fires and tears down the Pusher connection. No orphan subscriptions survive
logout. Polling fallback (15s) is used when Pusher credentials are unavailable.
