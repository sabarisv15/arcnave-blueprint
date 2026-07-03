# ARCNAVE — Tech Stack (locked)

Moved out of CLAUDE.md to keep that file small (it's auto-loaded every
session). See `docs/adr/` for rationale on each contested choice.

- **Backend**: Express (Node.js, plain JavaScript — not TypeScript),
  modular monolith — not microservices. Replaces FastAPI (Python) as
  of ADR-016 — a solo-maintainer productivity/comprehension call, not
  a performance or correctness one. Module 0's Python application code
  was deleted and rebuilt in Node, incrementally, in the same order it
  was originally built; the database design underneath it did not
  change.
- **Database**: PostgreSQL only — no MongoDB, no second datastore.
  node-postgres (`pg`) client with raw parameterized SQL in
  repositories — no ORM — and `node-pg-migrate` for migrations.
  pgvector for embeddings. JSONB for flexible config.
- **Auth**: JWT + RBAC + Tenant Middleware (not the old session-cookie
  auth).
- **Tenant isolation**: PostgreSQL Row-Level Security is mandatory,
  enforced via `SET LOCAL app.current_tenant` inside every request
  transaction — never a bare connection-level `SET` (pooled
  connections leak tenant context otherwise).
- **Frontend**: React + Tailwind (existing, being repointed at the new
  API).
- **Mobile/future desktop**: Flutter (separate codebase, same API).
- **AI**: Gemini (configurable provider), function-calling / tool-use
  pattern, never LangGraph/LangChain unless that decision is
  explicitly revisited.
- **File generation**: Node equivalents of openpyxl/python-docx/
  ReportLab (exact libraries not chosen yet — decide when Module 6
  Documents/OCR or a report-generation need actually arrives), as pure
  functions in a dedicated `generators/` module.
- **Deployment target**: Docker, Nginx, PostgreSQL backups.

## Known gaps (not yet decided, don't assume a fix exists)

- Background jobs: no Node equivalent of FastAPI `BackgroundTasks` has
  been chosen yet. See ADR-011's addendum. Decide when Module 8
  (Workflow & Notifications) needs it.
- API doc generation: no Node equivalent of FastAPI's auto-generated
  `docs/api/` exists yet. See Roadmap.md / Decisions-To-Revisit.md.
