# ARCNAVE — Architecture

Status: Frozen (decisions). Implementation: in progress.
Last updated: 2026-07-02

## 1. System Overview

ARCNAVE is a multi-tenant campus automation SaaS sold to multiple colleges.
Each college (tenant) gets its own scoped data, users, and configuration
under a shared application and database.

Product surface:
- Web app (React + Tailwind) — staff, HOD, principal dashboards
- Mobile app (Flutter) — staff-facing AI chat + core workflows
- Future desktop app (Flutter, shared codebase with mobile)
- AI Agent — natural-language interface over student/staff/attendance/
  finance/document data, with a hard authority boundary (see
  AI-Governance.md) between read-only, generate, and act operations.

Architectural style: **modular monolith**, not microservices.
See ADR-003. Revisit only when justified by real operational pain,
not by default trendiness.

## 2. Layers (top to bottom)

### 2.1 Platform layer
Separate application from the tenant product. Never shares auth or
database access with tenant requests — see ADR-013 / Decision on
Super Admin isolation.

Responsibilities:
- Super Admin Portal
- Tenant provisioning: college creation, college code generation,
  principal invitation, licensing/subscription
- Wildcard DNS + TLS (`*.arcnave.com`)

### 2.2 Clients
- React + Tailwind (web)
- Flutter (mobile, and future desktop — same codebase)
- Tenant resolution order: (1) subdomain, (2) JWT claim, (3) explicit
  college code at login. Not a single point of failure.

### 2.3 Security
- JWT — proves *who*
- RBAC — decides *what a role can do*
- Tenant Middleware — resolves `college_id` and, inside every request
  transaction, issues `SET LOCAL app.current_tenant = '<college_id>'`
  before any query runs. Never a bare connection-level `SET` — pooled
  connections would leak tenant context across requests. See ADR-002.

### 2.4 API layer — Express
- All endpoints under `/api/v1/...`. Versioned from day one, because
  mobile clients (Flutter) can't be force-updated the way a web
  refresh can — old app versions must keep working against v1 even
  after v2 ships.
- Middleware order: auth → tenant resolution → request logging →
  begin transaction → `SET LOCAL` → route handler.

### 2.5 Business Services layer
The single place business logic and business rules live. Every
consumer — website routes, mobile API calls, AI tools — calls
through this layer. Nothing (including AI tools) talks to a
repository or the database directly.

| Service | Owns |
|---|---|
| StudentService | Student records, enrollment, register/EMIS numbers |
| StaffService | Staff records, roles, department assignment |
| AcademicService | Academic year, semester, subjects, curriculum, faculty allocation, **timetable** |
| AttendanceService | Hour-wise attendance, attendance windows, lock; reads (does not own) timetable/approval state from AcademicService |
| FinanceService | Fees, fee structure, payments, scholarship eligibility |
| DocumentService | Sole owner of all files: upload, download, delete, versioning, templates, OCR source docs, tenant-prefixed storage paths, naming, metadata, retention |
| WorkflowService | All approvals — staff activation, fee changes, and every Level 3 (Act) AI action |
| NotificationService | Notification lifecycle; composes WorkflowService (approval) + DocumentService (templates) + external Email/SMS/WhatsApp providers. No repository of its own — see 2.6. |
| ReportService | Orchestrates data from other services into a `ReportModel`. Does not generate files itself. No repository of its own. |
| AnalyticsService | Aggregated/derived statistics across other services' data |
| ConfigurationService | Per-college settings as JSONB: attendance rules, fee structure, SMTP/SMS config, AI provider config, approval policies, branding, templates |

### 2.6 Generator Module
Pure functions. No database access, no storage access, no business
rules, no permissions. Input: a `ReportModel`. Output: file bytes.

- ExcelGenerator, PDFGenerator, WordGenerator, CSVGenerator, ChartGenerator

Flow: `ReportService → ReportModel → Generator → bytes → DocumentService → Storage`.
See ADR-008.

### 2.7 Repository layer
One repository per domain service that owns data:
StudentRepository, StaffRepository, AcademicRepository,
AttendanceRepository, FinanceRepository, DocumentRepository,
WorkflowRepository, AnalyticsRepository, ConfigurationRepository.

`ReportService` and `NotificationService` deliberately have none —
they orchestrate/compose, they don't persist their own domain data.

Rule: repositories never call other repositories. Services own
business logic; repositories own query mechanics only.

### 2.8 Data layer — PostgreSQL
Single database. No second datastore (no MongoDB, no Redis on day
one — see Decisions-To-Revisit.md).

- Relational tables for core domain data
- JSONB for flexible/per-tenant config, chat history, OCR results
- pgvector for embeddings (RAG)
- **Row-Level Security (RLS) is mandatory**, not optional — see
  ADR-002. `WHERE college_id = ...` alone is not sufficient; someone
  will eventually forget it. RLS makes the wrong query impossible to
  run, not just impolite to write.
- Dedicated tables: `notifications`, `notification_delivery`,
  `AuditLog`, `ApprovalHistory`, `ChatHistory`, `OCRResults`,
  `GeneratedReports`

### 2.9 File Storage
Owned exclusively by DocumentService. Tenant-prefixed paths.
Documents, templates, generated files (Excel/PDF/Word/CSV).

### 2.10 AI layer
See AI-Governance.md for the authority model. Structurally:

```
AI Agent → Tool Registry → [Read | Generate | Workflow] Tools
         → Business Services (never repositories, never storage)
         → Context Builder (wraps every tool output as untrusted data)
         → Prompt Safety Layer
         → LLM (Gemini; provider is configurable)
```

Function-call results return to the AI Agent for the next turn —
this loop is not drawn as a physical feedback arrow; it's the normal
tool-calling cycle.

## 3. Cross-cutting concerns

- **Tenant isolation**: Tenant Middleware (`SET LOCAL`) + PostgreSQL
  RLS, defense in depth. Verified by an automated integration test
  that runs two tenants' requests on the same pooled connection and
  asserts no leakage — this is a release gate, not a nice-to-have.
- **Observability**: structured JSON logs (request_id, tenant_id,
  user_id, service, action, duration_ms, status), daily rotation,
  error alerts, `/health` endpoint, audit logs kept separate from
  application logs.
- **Background jobs**: no mechanism chosen yet. `FastAPI
  BackgroundTasks` was the v1 plan under the Python backend; ADR-016
  retired it along with the rest of that stack, and nothing has
  replaced it — a real gap, not a naming difference, tracked in
  Decisions-To-Revisit.md rather than guessed at here. A Node
  equivalent gets chosen when Module 8 (Workflow & Notifications)
  first actually needs background work, not before. Redis + a real
  task queue (Celery/RQ/Dramatiq, or a Node equivalent) only once bulk
  imports, bulk notifications, or bulk OCR make lightweight background
  work insufficient — see Decisions-To-Revisit.md.
- **Import pipeline**: CSV/Excel → validation → staging tables →
  preview → conflict detection (Register Number / EMIS / Admission
  Number as business keys — **never Aadhaar**, see compliance note
  in AI-Governance.md) → user decision (skip / update / create /
  review) → commit. Idempotent. Every import supports dry-run before
  commit, and every import produces an audit record.

## 4. What this document is not
Module-level detail (tables, endpoints, screens per module) lives in
`docs/modules/`. Rationale for individual contested decisions lives
in `docs/adr/`. Business rules live in `BusinessRules.md`. This file
stays stable — it describes shape, not day-to-day specifics.
