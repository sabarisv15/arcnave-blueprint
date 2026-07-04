# RESULT

## Files changed
- `backend/src/services/financeService.js` (new)
- `backend/tests/finance-service.test.js` (new)

No API/UI/`docs/` files touched — matches this slice's own
service-only scope.

## What was built
`financeService.js` — business logic for both `fee_structures` and
`fee_payments`, calling only `financeRepository`/`feePaymentRepository`/
`auditLogRepository` (CLAUDE.md rule 1; never raw SQL, never storage).

**`fee_structures`**: `createFeeStructure`, `getFeeStructure`,
`updateFeeStructure`, `removeFeeStructure`, `listFeeStructuresForClassAndYear`,
`listFeeStructures`. Validates required fields (`academicYear`,
`classId`, `feeCategory`, `amount`) and that `status` is one of
`'Pending Approval'`/`'Approved'`/`'Rejected'` — same shape as
`academicService.createClass`/`updateClass`'s own `timetableStatus`
handling. Maps `fee_structures_college_year_class_category_key`
(23505) to `FeeStructureConflictError` and `fee_structures_class_id_fkey`
(23503) to `FeeStructureClassNotFoundError`. `removeFeeStructure` calls
`financeRepository.softDelete` — no hard-delete path exists, since the
repository itself exposes none.

**`fee_payments`**: `markFeePayment` (an upsert — find-then-create/update
by `(studentId, feeStructureId)`, same shape as
`attendanceService.markAttendance`), `getFeePayment`,
`listFeePaymentsForStudent`, `listFeePayments`, `removeFeePayment`.
`status` is a **required** parameter (unlike `fee_structures`, which
has a real unattended default) — omitting it on a "mark paid/not-paid"
call is a caller bug, not something to paper over with a silent
default. Maps `fee_payments_student_id_fkey`/`fee_payments_fee_structure_id_fkey`
(23503) and the `fee_payments_student_fee_structure_key` create-race
(23505) to their own domain errors, same shape
`attendanceService.markAttendance` uses for
`attendance_sessions_class_date_hour_key`. `removeFeePayment` is
soft-delete only, same as `removeFeeStructure`.

## The core design question: what does "mirror WorkflowService, same pattern" actually mean here?
This session's instruction asked to route `fee_structures` create/
update "through WorkflowService approval... mirror how Academic/
Attendance route their approval-gated writes through WorkflowService."
Before writing anything, re-read `academicService.js` and
`attendanceService.js` and grepped `backend/src` for `WorkflowService` —
**neither service actually calls one.** `academicService.js`'s own
file-level comment says so outright: WorkflowService (Module 8)
doesn't exist yet, Roadmap.md builds it after Finance, and this is
"the same 'out of scope here, not stubbed' reasoning" used elsewhere.
`attendanceService.js` restates the identical gap for its own
`timetable_status === 'Approved'` check.

So "the same pattern" is: validate the known status literal (mirroring
`classes.timetable_status` exactly — no DB CHECK, service-layer
enforcement only), and explicitly do **not** build, stub, or fake a
WorkflowService call, because there is nothing real to route through
yet. Building one here — even a minimal in-process approximation —
would be inventing infrastructure this codebase has deliberately and
repeatedly deferred, which contradicts "mirror the pattern" rather than
honoring it. This reasoning is spelled out in `financeService.js`'s own
file-level comment specifically so a future reader (or a future
session extending this file) doesn't mistake the missing gate for an
oversight.

## Other notable design decisions
- **`marked_by_user_id` is never mapped to its own "not found" error.**
  It's always `actorUserId`, the authenticated caller — never
  caller-supplied free text naming a different user (unlike
  `tutorUserId` on `classes`, which genuinely is caller-supplied and
  does get `ClassTutorNotFoundError`). `attendance_sessions.marked_by_user_id`
  set this exact precedent already: no `AttendanceMarkedByNotFoundError`
  class exists there either.
- **`collegeId` is a direct parameter to `markFeePayment`**, not
  derived from a lookup. Every other `createX` in this codebase
  (`createClass`, `createStudent`, `createFeeStructure`) takes
  `collegeId` directly from the tenant-scoped request context.
  `attendanceService.markAttendance` reusing `cls.college_id` is the
  one exception, and it's justified there by a class lookup
  `markAttendance` already needs for authorization — `markFeePayment`
  has no equivalent lookup to piggyback on, so it follows the dominant
  convention instead.
- **`removeFeeStructure`/`removeFeePayment` have no way to reach a hard
  delete**, structurally: `financeRepository`/`feePaymentRepository`
  expose no `remove` function at all (verified in both services' own
  test files via `assert.equal('remove' in <repo>, false)`), so there
  is nothing for the service layer to accidentally call even if it
  tried.

## Verification
1. **Unit tests** (`backend/tests/finance-service.test.js`, no live
   DB — same `node:test` mock technique as `academic-service.test.js`/
   `attendance-service.test.js`): 35 assertions covering —
   - Every required-field validation error, for both `fee_structures`
     and `fee_payments`, confirmed to short-circuit before touching
     the repository.
   - Every known-status literal accepted; every unknown literal
     rejected (`FeeStructureStatusError`/`FeePaymentStatusError`).
   - Unrecognized fields dropped before reaching the repository
     (`aadhaarNumber` probe, same as `academic-service.test.js`'s own).
   - Audit-log attribution to `actorUserId`/`userId`, correct
     `action`/`entity` on every write path.
   - `updateFeeStructure`'s no-op cases (no recognized fields;
     nonexistent id) correctly skip the audit entry.
   - Every constraint-violation mapping for both tables
     (`fee_structures_college_year_class_category_key`,
     `fee_structures_class_id_fkey`,
     `fee_payments_student_id_fkey`,
     `fee_payments_fee_structure_id_fkey`,
     `fee_payments_student_fee_structure_key`), trusting the
     constraint names already live-verified against a real Postgres in
     `326e8b5`/`c1b7aac` rather than re-verifying them here.
   - `markFeePayment`'s upsert branching: creates when no existing row,
     updates (re-stamping `markedByUserId`/`status`/`receiptDocumentId`)
     when one exists, with the correct `fee_payment_marked` vs.
     `fee_payment_remarked` audit action in each case.
   - Both `removeX` functions: no-op + no audit entry on a missing/
     already-soft-deleted id; soft-delete + audit entry on a real one;
     confirmed neither repository exposes a `remove` function to fall
     back to.
   - A non-conflict repository error passes through unchanged, for
     both `createFeeStructure` and `markFeePayment`.
2. **Full backend test suite**: `npm test` — **320/320 pass** (285
   prior + 35 new), 0 failures.

## Flags / open questions
- **No real WorkflowService gate on `fee_structures.status`** — see
  above. Restated, not newly discovered: `academicService.js` flagged
  this for `timetable_status`, `attendanceService.js` restated it, this
  file restates it a third time for the same underlying reason
  (Module 8 doesn't exist yet).
- **Scholarship eligibility remains fully unbuilt** — restated from
  both prior Finance slices' own RESULT.md entries: no income field
  exists anywhere in this schema yet.
- **`receipt_document_id`'s FK is still deferred** — restated from
  `c1b7aac`: no `documents` table exists yet (Module 6 unbuilt).
- **No API/UI yet for either table** — this slice is service-only, per
  its own scope. A future slice wires `/api/v1/fee-structures` and
  `/api/v1/fee-payments` routes (with RBAC — BusinessRules.md names no
  specific actor for "who may create a fee structure" or "who may mark
  a payment," left to the route/RBAC layer once those routes exist,
  same treatment `academicService.js` gives its own unauthorized
  operations).
