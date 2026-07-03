# ARCNAVE — Roadmap

## Build order (locked)

```
Module 0  — Platform Foundation
Module 1  — Student Management
Module 2  — Staff Management
Module 3  — Academic (Semester, Subjects, Timetable, Faculty Allocation)
Module 4  — Attendance
Module 5  — Finance
Module 6  — Documents & OCR
Module 7  — Reports
Module 8  — Workflow & Notifications
Module 9  — AI (Tool Registry, Context Builder, Prompt Safety, AI Tools, RAG)
Module 10 — Analytics
```

Dependency reasoning (why this order, not another):
- Academic (3) before Attendance (4): attendance marking is locked
  until a timetable is `Approved` — Attendance depends on Academic,
  never the reverse.
- Documents & OCR (6) before Reports (7): reports may reference
  generated/stored documents.
- Workflow & Notifications (8) before AI (9): AI's Level 3 (Act)
  actions route through WorkflowService approval — that mechanism
  must already exist and work before an AI tool tries to use it.
- AI (9) deliberately near the end, not Module 0: the Tool Registry,
  Context Builder, and Prompt Safety Layer are built against real
  Business Service interfaces. Building AI infrastructure before
  those services exist means guessing their shape and reworking it
  later — the same reasoning that deferred the Event Bus.

## Module 0 scope (Platform Foundation)

Everything required before a single student exists:

- **Platform**: Super Admin Portal, tenant provisioning, college
  creation, college code generation, principal invitation,
  subscription/licensing (simple v1)
- **Infrastructure**: PostgreSQL, node-pg-migrate migrations, RLS
  policies, file storage, structured logging, ConfigurationService
  schema, health checks
- **Identity**: JWT auth, RBAC, tenant resolution (subdomain → JWT
  → college code), password reset, MFA hooks (future, not built yet)
- **AI (configuration only)**: environment config, secrets
  management, LLM provider configuration. Not the Tool Registry,
  Context Builder, Prompt Safety, or Policy Engine — those are
  Module 9.
- **Developer platform**: CI pipeline, test framework, API
  versioning (`/api/v1`), coding standards, Docker Compose

## Development rule: vertical slices

Each module is built end-to-end before the next one starts:

```
ERD → Migration → Repository → Service → API → React (+ Flutter
where relevant) → Unit tests → Integration tests → Acceptance test
→ Deploy → Only then: next module
```

Not: all database work, then all backend, then all frontend. Modules
1–2 (Student/Staff) will feel slow through this gate since they're
mostly CRUD passing through many layers of ceremony for simple work
— that's expected, not a sign of doing it wrong. It pays off starting
around Module 3–4, where real business rules (timetable locks,
attendance windows) would otherwise fail silently without tests
catching them.

## Documentation discipline

- `Architecture.md` stays stable — written once, referenced often.
- `docs/modules/Module-NN-Name.md` is a living document, created at
  the start of that module's work, frozen (except bug fixes) once
  the module ships. Template: Purpose, Dependencies, Features,
  Business Rules, Database Tables, API Endpoints, UI Screens,
  Permissions, Tests, Known Limitations, Future Enhancements.
- `docs/api/` — no Node equivalent of FastAPI's auto-generated OpenAPI
  docs exists yet (ADR-016 retired that mechanism along with the rest
  of the Python backend). Not a decision to hand-write API docs
  instead; a real gap, tracked in `Decisions-To-Revisit.md` rather
  than guessed at here. Whatever replaces it, the same rule holds:
  never hand-written in advance of the code.
