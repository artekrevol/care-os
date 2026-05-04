# CareOS

## Overview

CareOS is an MVP multi-tenant home care operations platform designed to streamline home care agency management. It currently features a single-agency demo with a multi-tenant-ready data model. The platform aims to provide comprehensive solutions for client and caregiver management, scheduling, visit verification (EVV), payroll processing, and compliance. Future enhancements include AI agents, real-time collaboration, family portals, messaging, notifications, and route optimization.

## User Preferences

No explicit user preferences were provided in the original `replit.md` file.

## System Architecture

CareOS employs a modern web architecture:

-   **Frontend**: React with Vite, utilizing TanStack Query for data fetching, shadcn/ui for UI components, and wouter for routing.
-   **Backend**: Express API server, mounted at `/api`.
-   **Database**: PostgreSQL managed with Drizzle ORM, using a schema-per-table structure.
-   **API Specification**: OpenAPI for defining the API, with codegen for Zod schemas (`lib/api-zod`) for server-side validation and TanStack Query hooks (`lib/api-client-react`) for frontend integration.
-   **Core Modules**:
    -   **Clients**: Intake, profiles, and authorizations with payer, hours, and expiration tracking.
    -   **Caregivers**: Onboarding, document management (background checks, certifications), and expiration alerts.
    -   **Schedule**: Weekly visit assignment with conflict detection.
    -   **Visits / EVV**: GPS-enabled clock-in/out, geofence/duration exception flagging, and supervisor verification.
    -   **Payroll**: Pay period management, time entry, overtime/double-time calculation via a labor rule engine, and CSV export.
    -   **Labor Rules**: Configurable rule sets (e.g., CA, NY, TX, FLSA federal) applied during pay-period close. The engine handles daily double-time, daily overtime, weekly overtime, and seventh-day consecutive rules. Historical pay records are stamped with the rule version used.
    -   **Compliance**: Automated alerts for expiring authorizations, documents, geo mismatches, OT thresholds, and missed visits.
    -   **Audit Log**: Records significant mutations with actor, action, summary, and state changes.
-   **UI/UX**: Utilizes `shadcn/ui` for a consistent design system.
-   **Key Conventions**:
    -   All IDs are prefixed strings (e.g., `clt_*`, `cg_*`).
    -   Drizzle `numeric` columns are treated as strings and require type coercion.
    -   `date` columns are `YYYY-MM-DD` strings; `timestamp` columns are `Date` objects.
    -   Single-tenant constant `AGENCY_ID = "agency_demo"` for reads/writes.
    -   Audit logs are recorded inline in route handlers.
    -   Visit verification statuses: `PENDING` → (`VERIFIED` | `REJECTED`), with `EXCEPTION` for short durations.
-   **Performance & Concurrency**:
    -   Database indexes are applied to hot-path queries in agency-scoped tables.
    -   N+1 query problems are mitigated using batch-lookup patterns in list endpoints for schedules, visits, dashboard, family, and pay periods.
    -   BullMQ queues have explicit concurrency settings for various tasks (e.g., notification fan-out, AI processing).
-   **Automated Testing**: Vitest is used for critical-path automated tests, including labor rule engine unit tests, IVR security integration tests, and single-tenant invariant guards.

## External Dependencies

The platform integrates with several external services:

-   **Queueing**: BullMQ with `ioredis` (for job queues).
-   **AI**: Anthropic SDK (for agent run cost calculation).
-   **OCR**: AWS Textract (for document analysis).
-   **Real-time Communication**: Pusher (for server-side triggers).
-   **Object Storage**: Replit Object Storage with HMAC-signed pre-signed URLs.
-   **Notifications**:
    -   **Email**: Resend
    -   **SMS**: Twilio
    -   **Push**: Web-push
-   **Maps**: Google Distance Matrix API (with drive time cache).