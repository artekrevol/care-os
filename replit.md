# CareOS

## Overview

CareOS is a multi-tenant home care operations platform designed to provide a comprehensive solution for managing home care agencies. The project's vision is to streamline critical operations such as client intake, caregiver management, scheduling, payroll, and compliance, ultimately improving efficiency and care quality. The current MVP supports a single agency demonstration while being built on a multi-tenant-ready data model, paving the way for broader market adoption. Key capabilities include robust labor rule processing, electronic visit verification (EVV), and an extensive audit logging system. Future ambitions include integrating AI agents, real-time collaboration tools, and advanced optimization features to create a leading-edge platform in the home care industry.

## User Preferences

I prefer iterative development with clear communication on progress. Ask before making major architectural changes or introducing new external dependencies. I value well-documented code and a focus on maintainability.

## System Architecture

CareOS follows a modular architecture:

**Frontend:**
*   **Technology:** React with Vite, TanStack Query for data fetching, shadcn/ui for UI components, and wouter for routing.
*   **Design:** The UI/UX prioritizes a clean, functional interface using `shadcn/ui` for a consistent and modern look. PWA scaffolding is in place for future offline capabilities, including a manifest and service worker.

**Backend:**
*   **API Server:** An Express.js server handles API requests, mounted under `/api`.
*   **Database:** Drizzle ORM is used with PostgreSQL. The database schema is organized with a schema-per-table approach under `lib/db/src/schema/*`.
*   **API Specification:** OpenAPI is the source of truth for the API, with Zod schemas generated for server-side validation (`lib/api-zod`) and TanStack Query hooks generated for the frontend (`lib/api-client-react`).
*   **Multi-tenancy:** The system is designed with a multi-tenant data model, currently operating in a single-agency demo mode using `AGENCY_ID = "agency_demo"`. All IDs are prefixed strings for clear identification.

**Core Modules & Features:**
*   **Client Management:** Intake, profile management, and authorization tracking with payer details, hours, and expiration.
*   **Caregiver Management:** Onboarding, document management (background checks, certifications), and expiration alerts.
*   **Scheduling:** Weekly visit assignment with conflict detection.
*   **Visits / EVV:** Clock-in/out with GPS, geofence/duration exception flagging, and supervisor verification.
*   **Payroll:** Manages pay periods, time entries, and calculates overtime/double-time using a configurable labor rule engine. Supports CSV export.
*   **Labor Rules Engine:** Located at `artifacts/api-server/src/lib/laborRuleEngine.ts`, it applies rules for daily/weekly overtime and seventh-day consecutive work based on configurable state-specific rule sets.
*   **Compliance:** Auto-generates alerts for expiring authorizations, documents, geo mismatches, OT thresholds, and missed visits.
*   **Audit Log:** Records every significant data mutation with actor, action, summary, and before/after states.

**Phase 2 Enhancements (Foundation):**
*   **Shared Services:** A `lib/services` module (`@workspace/services`) provides entry points for various integrations, designed to degrade gracefully if environment variables are missing.
*   **AI Agent Integration:** Foundation for AI agents, including `startAgentRun` / `completeAgentRun` / `failAgentRun` / `recordAgentRun` for tracking and cost estimation.
*   **Real-time Capabilities:** Planned for real-time collaboration and messaging.
*   **Object Storage:** Replit Object Storage with HMAC-signed pre-signed URLs for secure uploads/reads.
*   **Notifications:** Fan-out notification system using Resend (email), Twilio (SMS), and web-push.
*   **Maps:** Google Distance Matrix integration with a drive-time cache.

**System Health & Monitoring:**
*   **Service Status Tracker:** `lib/services/src/health/index.ts` maintains a 24-hour ring buffer of success timestamps and recent errors for critical services.
*   **Admin Routes:** Owner-only routes for system health monitoring, probing services, and managing BullMQ queues (retry/discard failed jobs).
*   **DLQ Monitoring:** `dlqWatch.ts` periodically checks for failed jobs in queues and sends email alerts to owners if thresholds are exceeded.

**Performance & Concurrency Tuning:**
*   **Database Indexes:** Composite indexes are implemented across agency-scoped tables to optimize hot-path queries.
*   **N+1 Query Elimination:** Batch-lookup patterns are used in list endpoints and dashboard queries to reduce database calls.
*   **BullMQ Concurrency:** Explicit concurrency settings for each queue optimize processing of I/O-bound and compute-intensive tasks.
*   **Pusher Channel Lifecycle:** Optimized for real-time messaging with careful management of channel subscriptions and disconnections to prevent leaks.
*   **Query Counter:** An `AsyncLocalStorage`-based query counter provides `X-Query-Count` response header for API requests, aiding in performance analysis.

## External Dependencies

*   **Database:** PostgreSQL (with Drizzle ORM)
*   **Frontend Libraries:** React, Vite, TanStack Query, shadcn/ui, wouter
*   **Backend Framework:** Express.js
*   **API Definition:** OpenAPI (for spec generation)
*   **Queueing:** BullMQ, ioredis (for Redis integration)
*   **AI:** Anthropic SDK
*   **OCR:** AWS Textract
*   **Real-time:** Pusher
*   **Object Storage:** Replit Object Storage
*   **Email:** Resend
*   **SMS:** Twilio
*   **Maps:** Google Maps Distance Matrix API
*   **Testing:** Vitest, Playwright (for demo screenshots)