
# ARCNAVE — project context

This file is auto-loaded by Claude Code at the start of every
session. Read `docs/architecture/Architecture.md` and
`docs/architecture/BusinessRules.md` in full before writing or
modifying any backend code — they are authoritative, not background.

## What this project is

ARCNAVE is a multi-tenant campus automation SaaS being rebuilt from
an existing prototype (a dual Python/FastAPI+SQLite and Node/Express
+MongoDB campus automation app). The prototype validated the product
scope; it is not the foundation. The backend is being rebuilt fresh,
module by module, on the architecture below. The existing React
frontend is being kept and progressively repointed at the new API as
each module ships.

## Stack (locked — see docs/adr/ for rationale)

- Backend: Express (Node.js, plain JavaScript — not TypeScript),
  modular monolith — not microservices. Replaces FastAPI (Python) as
  of ADR-016 — a solo-maintainer productivity/comprehension call, not
  a performance or correctness one. Module 0's Python application code
  was deleted and is being rebuilt in Node, incrementally, in the same
  order it was originally built; the database design underneath it did
  not change.
- Database: PostgreSQL only — no MongoDB, no second datastore.
  node-postgres (`pg`) client with raw parameterized SQL in
  repositories — no ORM — and `node-pg-migrate` for migrations.
  pgvector for embeddings. JSONB for flexible config.
- Auth: JWT + RBAC + Tenant Middleware (not the old session-cookie
  auth)
- Tenant isolation: PostgreSQL Row-Level Security is mandatory,
  enforced via `SET LOCAL app.current_tenant` inside every request
  transaction — never a bare connection-level `SET` (pooled
  connections leak tenant context otherwise)
- Frontend: React + Tailwind (existing, being repointed at new API)
- Mobile/future desktop: Flutter (separate codebase, same API)
- AI: Gemini (configurable provider), function-calling / tool-use
  pattern, never LangGraph/LangChain unless that decision is
  explicitly revisited
- File generation: openpyxl / python-docx / ReportLab equivalents,
  as pure functions in a dedicated `generators/` module
- Deployment target: Docker, Nginx, PostgreSQL backups

## Non-negotiable rules while writing code

1. Every AI tool calls a Business Service. Never a repository, never
   raw SQL, never Storage directly — even for pure file-generation
   with no DB write involved.
2. `DocumentService` is the sole owner of file storage. Nothing else
   writes to Storage.
3. `WorkflowService` is the sole approval gate — for human-initiated
   approvals and every AI Level 3 ("Act") action alike.
4. Repositories never call other repositories.
5. All API routes live under `/api/v1/`.
6. Every migration must be reversible.
7. Academic (timetable) must exist and be functioning before
   Attendance is built — attendance marking is locked behind
   `timetable_status == 'Approved'`.
8. Never use Aadhaar numbers for student identity, dedup, import,
   search, AI reasoning, or reporting.
9. AI tool outputs (retrieved documents, OCR text, any human-entered
   free-text field) are always wrapped as untrusted data before
   reaching the LLM — never treated as instructions.

## Build order

See `docs/architecture/Roadmap.md`. Short version: Module 0
(Platform Foundation: auth, RLS, provisioning, CI, Docker) first,
then Student → Staff → Academic → Attendance → Finance → Documents/
OCR → Reports → Workflow/Notifications → AI → Analytics, each module
built vertically (DB → repository → service → API → UI → tests)
before the next one starts.

## Where to look for more detail

- `docs/architecture/Architecture.md` — full system shape
- `docs/architecture/BusinessRules.md` — every domain rule
- `docs/architecture/AI-Governance.md` — AI authority levels, prompt
  safety, data classification
- `docs/architecture/DevelopmentStandards.md` — the rules above, in
  full, plus the review discipline for `Decisions-To-Revisit.md`
- `docs/adr/` — rationale for every contested decision
- `docs/modules/` — per-module specs, created as each module starts
