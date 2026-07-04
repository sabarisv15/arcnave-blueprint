# TASK

## Objective
Module 5 (Finance), second vertical slice: `fee_payments` migration +
repository only — no service, API, UI, or `docs/` files. Same
discipline as every prior module's first/second slice (`ef0a76c`,
`49c8b4b`, `326e8b5`).

## Grounding
Same situation as `fee_structures` (326e8b5, see `.ai/RESULT.md` at
that commit): no real fee/invoice/payment screen exists anywhere in
`frontend/src` to ground field/shape decisions against. This slice's
shape comes directly from this session's own explicit instruction, not
a working screen:

- `student_id` (FK `students`), `fee_structure_id` (FK `fee_structures`),
  `status` (`paid`/`not_paid`), `marked_by` (FK to the acting user),
  `receipt_document_id` (nullable, intended as a future FK to a
  `documents` table owned by DocumentService — do not write to
  storage, just reserve the reference column), `deleted_at` soft-delete
  (same pattern as `fee_structures`).
- Explicitly **not** an amount/transaction/ledger table — a manual
  paid/not-paid flag only, set from the student profile screen.
- Unique constraint: one active row per `(student_id, fee_structure_id)`
  `WHERE deleted_at IS NULL`.
- RLS + tenant isolation, same pattern as `fee_structures`.

## Pre-check: migrate.js count:1 fix
Confirmed already committed (`833535a`, prior to this session) before
touching anything: `backend/scripts/migrate.js` line ~20 sets
`count = direction === 'down' ? 1 : Infinity`. No separate fix commit
needed this session.

## Key design decisions
- **`receipt_document_id` has no FK constraint.** `documents` doesn't
  exist anywhere in this schema — grepped every migration to confirm
  (Module 6, Documents & OCR, hasn't been built; Roadmap.md puts it
  after Finance). Postgres cannot reference a nonexistent table, so
  this is a bare nullable `UUID` column with no `REFERENCES` clause. A
  later migration, once Module 6 creates `documents`, must add the FK
  via `ALTER TABLE ... ADD CONSTRAINT`. Flagged prominently in the
  migration's own comment, not silently dropped or faked with a
  same-named-but-wrong reference.
- **`marked_by_user_id`, not `marked_by`** — naming matches
  `attendance_sessions.marked_by_user_id`/`classes.tutor_user_id`
  exactly: FK to `users(id)`, never `staff(id)`, per BusinessRules'
  already-resolved Module 2 "faculty reference is a users.id" entry.
  NOT NULL, same reasoning `attendance_sessions.marked_by_user_id`
  already established — a row only exists once a mark has actually
  been made; there's no "unmarked" row state.
- **`status` mirrors `fee_structures.status`/`classes.timetable_status`**
  — free TEXT, no CHECK, `'not_paid'` default, known values enforced
  at the service layer once FinanceService exists (not built this
  slice).
- **`deleted_at` (soft-delete) resolved now**, same as
  `fee_structures` — BusinessRules.md's AI section names "fees"
  explicitly for soft-delete-only. GRANT omits DELETE.
- **Partial unique index** `(student_id, fee_structure_id) WHERE
  deleted_at IS NULL` — no explicit `college_id` in the constraint,
  matching `attendance_sessions`'s own precedent: both FK columns are
  already tenant-scoped via their referenced tables.
- **New repository file** (`feePaymentRepository.js`), not appended to
  `financeRepository.js` — matches the established file-per-table
  convention (`classRepository.js` vs. `facultyAllocationRepository.js`/
  `timetablePeriodRepository.js` under the same "Academic" service),
  not Architecture.md's shorthand one-repository-per-service wording.

## Files likely affected
- `backend/migrations/1752400000000_module-5-finance-fee-payments-schema.js`
- `backend/src/repositories/feePaymentRepository.js`

## Acceptance criteria
- Migration runs up cleanly; RLS enabled+forced, tenant_isolation
  policy present.
- Partial unique index proven with a real constraint-violation insert,
  including the soft-delete-then-recreate case.
- FK enforcement proven live on all three real FKs (`student_id`,
  `fee_structure_id`, `marked_by_user_id`).
- `receipt_document_id` accepts an arbitrary UUID with no FK to
  violate, as designed.
- Real DELETE statement rejected by Postgres itself.
- Migration down/up reversibility confirmed using the now-fixed
  `scripts/migrate.js` (`down` reverts only `fee_payments`, leaving
  `fee_structures` and everything else untouched).
- Full backend test suite still passes.
- No service/API/UI/`docs/` files touched.
- Flag, don't build: Student module needs an `annual_income` field +
  optional income-certificate document reference in a future
  Student-module migration — required before scholarship eligibility
  (BusinessRules.md Finance's second rule) can be computed at all.
