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
