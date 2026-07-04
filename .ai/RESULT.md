# RESULT

## Files changed
- `backend/migrations/1752400000000_module-5-finance-fee-payments-schema.js` (new)
- `backend/src/repositories/feePaymentRepository.js` (new)

No service/API/UI/`docs/` files touched — matches this slice's own
migration+repository-only scope.

## What was built
`fee_payments`: a manual paid/not-paid **flag**, not a payment ledger
— explicitly no amount/transaction/installment fields, per this
session's instruction. One row per (student, fee line): `id`,
`college_id` (FK `colleges`), `student_id` (FK `students`, NOT NULL),
`fee_structure_id` (FK `fee_structures`, NOT NULL), `status`
(`'not_paid'` default, mirrors `fee_structures.status`),
`marked_by_user_id` (FK `users`, NOT NULL — never `staff`, per the
already-resolved Module 2 convention), `receipt_document_id` (nullable
`UUID`, **no FK** — see below), `deleted_at`, `created_at`,
`updated_at`.

Tenant-scoped like every other table: RLS enabled + forced,
`tenant_isolation` policy on `college_id`. Soft-delete only
(`deleted_at`, no DELETE grant) — same BusinessRules.md AI-section
reasoning ("fees" named explicitly) as `fee_structures`. Partial
unique index on `(student_id, fee_structure_id) WHERE deleted_at IS
NULL`.

`feePaymentRepository.js` (new file, not appended to
`financeRepository.js` — matches the established file-per-table
convention): `create`, `findById`, `findByStudentAndFeeStructure`,
`findByStudentId`, `update`, `softDelete`, `list`. No `remove`/
hard-delete function, same structural guarantee `financeRepository.js`/
`attendanceRepository.js` already establish.

## receipt_document_id has no FK constraint — flagged, not worked around
This session's instruction asked for "a nullable FK to documents
table, owned by DocumentService." Grepped every migration in
`backend/migrations/` to confirm: **no `documents` table exists
anywhere in this schema.** Module 6 (Documents & OCR) hasn't been
built yet (Roadmap.md puts it after Finance). Postgres cannot create a
foreign key against a table that doesn't exist, so this column is a
bare nullable `UUID` with no `REFERENCES` clause — the intended
meaning (which receipt document, if any, backs this payment mark) is
reserved and documented in the migration's own comment, but the
constraint itself is deferred. A later migration, once Module 6
creates `documents`, must run:
```sql
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_receipt_document_id_fkey
    FOREIGN KEY (receipt_document_id) REFERENCES documents(id)
```
Verified live that the column currently accepts any arbitrary UUID
with no constraint violation (see Verification #6 below) — proving
this is a real, working gap, not an oversight that happens to look
fine.

## Pre-check performed
Confirmed the `migrate.js` `count: 1`-on-`down` fix (commit `833535a`)
was already committed before starting this slice — no separate fix
commit was needed. Used the real `scripts/migrate.js` (not a one-off
runner) for both migration up and reversibility verification this
time, since it's now safe to.

## Verification
All performed live against the real `docker-compose` Postgres 16
already running in this environment (`arcnave-blueprint-db-1`).

1. **Migration up**: ran cleanly via `node scripts/migrate.js up`.
2. **Schema shape** (via `docker exec ... psql`): confirmed all four
   FKs (`college_id`, `student_id`, `fee_structure_id`,
   `marked_by_user_id`), confirmed `receipt_document_id` has **no**
   FK listed, confirmed the partial unique index's exact definition,
   `relrowsecurity`/`relforcerowsecurity` both `t`, the
   `tenant_isolation` policy text, and `arcnave_app`'s grant (`arw` —
   no DELETE).
3. **Repository, exercised live** through the `arcnave_app` role with
   real `SET LOCAL app.current_tenant` context (ephemeral script,
   seeded two real tenants + a class + a student + a staff user + a
   fee_structure via the admin role, deleted after):
   - `create()` applies the `'not_paid'` DEFAULT status and leaves
     `receipt_document_id` null when omitted.
   - `findById`, `findByStudentAndFeeStructure`, `findByStudentId` all
     correct.
   - **Cross-tenant isolation**: college B's `findById` on college A's
     row id returns `null`.
   - **Partial unique index**: a duplicate `(student_id,
     fee_structure_id)` insert while the first row is live is rejected
     with a real Postgres `23505`; after `softDelete`-ing the first
     row, the identical key can be re-inserted successfully (new row
     id).
   - `update()` marks a row `paid` and stores an arbitrary
     `receipt_document_id` (a random UUID) with **no** constraint
     violation — proves #6's "no FK yet" claim isn't just a reading of
     the DDL, it's actually true at runtime.
   - `softDelete()` hides the row from `findById` immediately, and is
     idempotent against an already-deleted or missing id.
   - **Real hard-DELETE rejected by Postgres itself**: `42501`
     (`insufficient_privilege`) through the `arcnave_app` connection.
   - **FK enforcement, all three real FKs individually proven**:
     bogus `student_id` -> `23503`; bogus `fee_structure_id` ->
     `23503`; bogus `marked_by_user_id` -> `23503` (this last check
     needed a second, distinct `fee_structure_id` in the test to avoid
     colliding with the unique-index case from an earlier step — a
     test-script ordering issue, not a repository bug; corrected and
     re-run).
4. **Migration reversibility**, using the real (now-fixed)
   `scripts/migrate.js` directly: `down` dropped only `fee_payments`,
   confirmed via `docker exec ... psql` that `fee_structures` (and
   everything else) remained; `up` restored `fee_payments` as final
   state.
5. **Full backend test suite**: `npm test` — **285/285 pass**, 0
   failures.
6. All seeded verification data and the temporary verification script
   deleted afterward; final DB state is the migrated-up schema with
   empty tables, same as before this session started.

## Flags / open questions
- **`receipt_document_id`'s FK is deferred, not built** — see above.
  Needs a follow-up migration once Module 6 (Documents & OCR) creates
  `documents`.
- **Scholarship eligibility remains fully unbuilt** (restated from
  `fee_structures`' own RESULT.md): BusinessRules.md Finance's second
  rule — "Students below a configured income threshold become
  scholarship eligible" — cannot be computed today. **New, explicit
  ask for the Student module**: a future Student-module migration
  needs to add an `annual_income` field (and optionally an
  income-certificate document reference, same "reserve the column, no
  FK until DocumentService exists" treatment `receipt_document_id` got
  here) to `students` — out of scope for this Finance slice, but now
  named as a concrete cross-module dependency rather than a vague
  "something needs to change" gap.
- **No transaction/ledger table** — `fee_payments` is a flag, not a
  payment history; partial payments, refunds, or multiple installments
  per fee line are unrepresentable in this shape by design, per this
  session's explicit instruction. Revisit only if a real product
  requirement asks for it.
- **`fee_structures.status`/WorkflowService gate still open** —
  restated from the prior slice, unchanged by this one.
