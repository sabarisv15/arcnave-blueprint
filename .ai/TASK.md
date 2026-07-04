# TASK

## Objective
Module 5 (Finance), first vertical slice: ERD + migration + repository
only — no service, API, UI, or `docs/` files. Same discipline as every
prior module's first slice (`ef0a76c` Module 3 classes, `49c8b4b`
Module 4 attendance_sessions).

## Grounding — and its absence
Unlike Module 3/4, there is **no existing Finance screen** in the
frontend to ground field/shape decisions against. Checked explicitly
before writing anything:
```
grep -ril "fee\|scholarship\|invoice\|payment" frontend/src backend/src
```
Hits: `CampusAICopilot.jsx` (a canned demo chat reply — "💳 Fee
Reminders... ₹48,200 outstanding"), `DocumentPanel.jsx` (a document
*category* option, `scholarship_cert`), `CampusBrain.jsx` (a suggested-
question chip), `configurationService.js`/`routes/configurations.js`
(comments only, no schema). None of these is a real, working, wired
screen the way `StaffDashboard.jsx`/`TutorClass.jsx` were for
Attendance/Academic — no fee/invoice/payment screen exists at all.
This slice is built from `BusinessRules.md`'s Finance section and
`Architecture.md`'s data-model conventions only.

`BusinessRules.md` Finance section, in full (two rules, nothing else):
- "Fee changes require approval before taking effect."
- "Students below a configured income threshold become scholarship
  eligible (exact threshold is per-tenant config, not hardcoded)."

`Architecture.md` 2.5: `FinanceService` owns "Fees, fee structure,
payments, scholarship eligibility" — four concerns, not one table's
worth. This slice builds the first and most foundational of those: the
fee **definition** (`fee_structures`), not the per-student
transactional record (invoices/payments) — same "structure before the
transactional record" sequencing Module 3's `classes` used before
Module 4's `attendance_sessions`.

## Key design decisions

- **`fee_structures`, not `fees`**: matches Architecture.md's own term
  ("fee structure") and Module 3's `classes` precedent of naming the
  definitional entity, not the generic domain noun.
- **status column mirrors `classes.timetable_status` exactly**:
  `'Pending Approval'` (default) | `'Approved'` | `'Rejected'`, no
  CHECK constraint — known values enforced at the service layer once
  FinanceService exists (not built this slice), same house convention
  as `timetable_status`/`users.role`/`colleges.subscription_status`.
  Directly grounded in BusinessRules' "fee changes require approval
  before taking effect." WorkflowService (Module 8) doesn't exist yet,
  so nothing can really gate on this end-to-end today — same open gap
  Module 3 flagged for `timetable_status` and Module 4 restated for
  attendance; not worked around here either.
- **`deleted_at` (soft-delete) resolved now, not left open**:
  BusinessRules.md's AI section names "fees" explicitly alongside
  attendance and marks — "The AI is never given a hard-delete
  capability on attendance, fees, or marks records, even with
  approval — only soft-delete." Same treatment `attendance_sessions`
  got in Module 4, for the identical, directly-named reason. The GRANT
  omits DELETE entirely (DB-permission-level enforcement, not just
  repository discipline).
- **Partial unique index** `(college_id, academic_year, class_id,
  fee_category) WHERE deleted_at IS NULL` — same reasoning as
  `attendance_sessions_class_date_hour_key`: a plain UNIQUE would
  permanently block re-creating a fee line once one copy was
  soft-deleted.

## Flagged assumptions (no frontend to confirm against)
- **`class_id` is NOT NULL** — every fee line is scoped to one class
  for one academic year. There is no "college-wide default fee" row
  shape in this schema; a fee identical across every class would mean
  one row per class with the same amount, not a nullable
  "applies-to-all" row. Nothing in BusinessRules.md or Architecture.md
  says whether fees are ever defined above/below the class level
  (per-department, per-college, per-student override) — flagged as
  open rather than guessed.
- **`academic_year` is free TEXT**, not a FK — there is no
  `academic_years` table anywhere in this schema (Module 3 only ever
  modeled `semester` as free TEXT on `classes`). Matches existing
  convention.
- **`fee_category` is free TEXT**, not a FK to a normalized category
  table — same "don't normalize what nothing queries that way yet"
  reasoning Module 3's first slice used for `classes.timetable_data`
  and its normalization slice restated for `faculty_allocation.subject`.
- **No scholarship-eligibility table/column this slice.** The income
  *threshold* is "per-tenant config" — that's exactly what the
  existing `configurations` JSONB table (Module 0, already built) is
  for (Architecture.md 2.5's ConfigurationService row already lists
  "fee structure" as a category that table can eventually hold). Not
  added here: no service consumes it yet, same restraint
  `configurationService.js`'s own file comment already documents for
  every category it doesn't validate. Bigger flagged gap: **there is
  no income field anywhere in this schema** — not on `students`
  (checked Module 1's migration, no such column), not here. Computing
  "students below a threshold" needs an income figure to compare
  against that doesn't exist yet; a later Finance slice must add it
  (most likely on `students`, since income is a per-student fact, not
  a per-fee-line one). Not invented here.
- **No `approved_by_user_id`/`approved_at` columns** — matches
  `classes.timetable_status`'s own precedent: Module 3 added status +
  remarks only, deferring approval bookkeeping to WorkflowService
  itself (Module 8) rather than pre-building columns nothing can
  populate yet. `remarks` mirrors `timetable_remarks` for the same
  reason.

## Files likely affected
- `backend/migrations/1752300000000_module-5-finance-schema.js`
- `backend/src/repositories/financeRepository.js`

## Acceptance criteria
- Migration runs up cleanly against a live Postgres; RLS
  enabled+forced with the tenant_isolation policy pattern.
- Partial unique index proven with a real constraint-violation insert,
  including the soft-delete-then-recreate case.
- FK enforcement on `class_id`/`college_id` proven live.
- Repository's every function exercised live through the `arcnave_app`
  role with real `SET LOCAL app.current_tenant` context, including a
  cross-tenant isolation check.
- Real DELETE statement rejected by Postgres itself (permission denied,
  not just absent from the repository).
- Migration down reverts only `fee_structures`; re-up restores it.
- Full backend test suite still passes (no regressions from adding a
  new migration/table to the shared schema).
- No service/API/UI/`docs/` files touched.
