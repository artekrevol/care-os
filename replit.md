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
