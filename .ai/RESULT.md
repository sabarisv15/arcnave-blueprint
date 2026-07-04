# RESULT

## Files changed
- `backend/migrations/1752300000000_module-5-finance-schema.js` (new)
- `backend/src/repositories/financeRepository.js` (new)

No service/API/UI/`docs/` files touched — matches this slice's own
migration+repository-only scope.

## What was built
`fee_structures`: the fee **definition** table (one row per college /
academic year / class / fee category), not the per-student
transactional record — invoices/payments are a later Finance slice.
Columns: `id`, `college_id` (FK `colleges`), `academic_year` (free
TEXT), `class_id` (FK `classes`, NOT NULL), `fee_category` (free TEXT),
`amount` (`NUMERIC(12,2)`), `status` (`'Pending Approval'` default,
mirrors `classes.timetable_status`), `remarks`, `deleted_at`,
`created_at`, `updated_at`.

Tenant-scoped like every other table: RLS enabled + forced,
`tenant_isolation` policy on `college_id`. Soft-delete only (`deleted_at`,
no DELETE grant) — resolved now rather than left open, because
BusinessRules.md's AI section names "fees" explicitly alongside
attendance/marks for soft-delete-only. Partial unique index on
`(college_id, academic_year, class_id, fee_category) WHERE deleted_at
IS NULL`.

`financeRepository.js`: `create`, `findById`,
`findByCollegeClassYearCategory`, `findByClassAndYear`, `update`,
`softDelete`, `list` — no `remove`/hard-delete function exists at all,
same structural guarantee `attendanceRepository.js` established.

## No frontend grounding — confirmed, not assumed
Grepped `frontend/src` and `backend/src` for
`fee|scholarship|invoice|payment` before writing anything. Every hit
was incidental (a canned AI-copilot demo reply, a document-upload
category option, a suggested-question chip, or comments) — no real,
working fee/invoice/payment screen exists anywhere in this codebase,
unlike Module 3/4 which had `TutorClass.jsx`/`StaffDashboard.jsx` to
ground against. The full ERD is sourced from `BusinessRules.md`'s
Finance section (two rules) and `Architecture.md`'s data-model
conventions, with every non-obvious shape decision flagged in the
migration's own comments and in `.ai/TASK.md` rather than guessed at
silently.

## Flagged assumptions (open, not resolved by this slice)
- `class_id` is NOT NULL — no "applies to all classes" row shape
  exists; a truly college-wide fee would need one row per class today.
- `academic_year`/`fee_category` are free TEXT, not FKs — no
  `academic_years` or fee-category table exists, matching the existing
  `classes.semester`/`faculty_allocation.subject` free-text precedent.
- **Scholarship income threshold has no home yet.** BusinessRules'
  "per-tenant config" threshold belongs in the existing `configurations`
  JSONB table (already built, Module 0) once a FinanceService consumes
  it — not added here, same restraint `configurationService.js` already
  documents for every category it doesn't validate. More importantly:
  **no income field exists anywhere in this schema** (checked
  `students`' migration) — "students below a threshold" cannot be
  computed at all until a later slice adds one, most likely to
  `students`. Real, named gap, not worked around.
- No `approved_by_user_id`/`approved_at` — deferred to WorkflowService
  (Module 8), matching `classes.timetable_status`'s own precedent of
  adding status+remarks only, ahead of a real approval mechanism.

## Verification
All performed live against the real `docker-compose` Postgres 16
already running in this environment (`arcnave-blueprint-db-1`) — no
embedded-postgres substitute needed this time.

1. **Migration up**: ran cleanly via `node scripts/migrate.js up`
   (`MIGRATION_DATABASE_URL` as `arcnave_admin`).
2. **Schema shape** (via `docker exec ... psql`): confirmed column
   types/defaults, the partial unique index's exact definition, both
   FKs (`class_id -> classes(id)`, `college_id -> colleges`),
   `relrowsecurity`/`relforcerowsecurity` both `t`, the `tenant_isolation`
   policy text, and `arcnave_app`'s grant (`arw` — SELECT/INSERT/UPDATE,
   no DELETE, confirmed via `\dp`).
3. **Repository, exercised live** through the `arcnave_app` role with
   real `SET LOCAL app.current_tenant` context (ephemeral script,
   seeded two real tenants + classes via the admin role, deleted after):
   - `create()` applies the `'Pending Approval'` DEFAULT when `status`
     is omitted; `amount` round-trips through `NUMERIC` correctly.
   - `findById`, `findByCollegeClassYearCategory`, `findByClassAndYear`
     all correct.
   - **Cross-tenant isolation**: college B's `findById` on college A's
     row id returns `null` — RLS holds through the repository, not just
     at the SQL level.
   - **Partial unique index**: a duplicate `(college_id, academic_year,
     class_id, fee_category)` insert while the first row is live is
     rejected with a real Postgres `23505` (`unique_violation`); after
     `softDelete`-ing the first row, the identical key can be
     re-inserted successfully (new row id) — proving the `WHERE
     deleted_at IS NULL` partial index actually excludes soft-deleted
     rows rather than just being decorative.
   - `update()` amends `status`/`amount` correctly.
   - `softDelete()` hides the row from `findById` immediately, and is
     idempotent against an already-deleted or missing id (returns
     `null` on the second call, no error).
   - **Real hard-DELETE rejected by Postgres itself**: an explicit
     `DELETE FROM fee_structures ...` through the `arcnave_app`
     connection failed with `42501` (`insufficient_privilege`) — proves
     the no-hard-delete guarantee is a DB-permission fact, not just
     "the repository happens not to expose it."
   - **FK enforcement**: `create()` with a random UUID `class_id` fails
     with `23503` (`foreign_key_violation`).
4. **Migration reversibility**: node-pg-migrate's own `count` option
   (not this project's `scripts/migrate.js`, whose `down` uses
   `count: Infinity` and would revert the *entire* schema — learned
   this the hard way mid-verification, immediately re-ran `up` to
   restore state, confirmed via `docker exec ... psql` that all tables
   were back and empty, i.e. no real data existed to lose in this
   session). Used a one-off `count: 1` runner instead: `down` dropped
   only `fee_structures`, leaving `faculty_allocation` (and everything
   else) untouched; `up` restored `fee_structures` as final state.
5. **Full backend test suite**: `npm test` — **285/285 pass**, 0
   failures, confirming the new migration doesn't regress any existing
   module.
6. All seeded verification data and temporary scripts deleted
   afterward; final DB state is the migrated-up schema with empty
   tables, same as before this session started.

## Flags / open questions
- **No `academic_years` table** — `academic_year` stays free TEXT,
  same as `classes.semester`. Revisit only if a later slice needs to
  query/validate it structurally.
- **Scholarship eligibility computation is fully unbuilt** — no income
  field, no threshold-config category, no eligibility flag/table. This
  is the single biggest open gap in Module 5's BusinessRules and needs
  a real product answer (where does income get captured — student
  self-reported? uploaded document via Module 6 DocumentService? a
  College Admin bulk import?) before the next Finance slice can build
  it, not guessed at here.
- **Invoices/payments (the per-student transactional side of
  FinanceService) not started** — this slice is the fee definition
  only, same sequencing Module 3 (classes) used before Module 4
  (attendance_sessions).
- **`fee_structures.status` can't be end-to-end gated yet** —
  WorkflowService (Module 8) doesn't exist, same restated gap Module 3
  flagged for `timetable_status` and Module 4 restated for attendance.
