# TASK

## Objective
Module 5 (Finance), third vertical slice: `FinanceService` only — no
API/UI. DB + repository already done for `fee_structures` (`326e8b5`)
and `fee_payments` (`c1b7aac`).

## Scope (this session's own instruction)
- `fee_structures` CRUD: create/update always "goes through
  WorkflowService approval" (BusinessRules: "fee changes require
  approval before taking effect") — mirror how Academic/Attendance
  route their approval-gated writes through WorkflowService, same
  pattern.
- `fee_payments` mark paid/not-paid: simple write, no WorkflowService
  gate (manual student-profile action, not a "fee change").
- Service calls repository only, never raw SQL/storage (CLAUDE.md
  rule 1).
- Soft-delete only, no hard delete, on both.

## Pre-check: what "the same pattern" actually is in this codebase
Read `academicService.js` and `attendanceService.js` before writing
anything, since the instruction says to mirror them. Neither actually
calls a real WorkflowService — grepped for `WorkflowService` across
`backend/src`: the only hits are comments. `academicService.js`'s own
file-level comment states it outright: "CLAUDE.md rule 3: WorkflowService
is the sole approval gate, and it doesn't exist yet (Roadmap.md builds
Workflow/Notifications after Attendance/Finance/Documents/Reports) —
same 'out of scope here, not stubbed' reasoning." `attendanceService.js`
restates the identical gap for its own `timetable_status === 'Approved'`
check.

So "the same pattern" this session's instruction asks to mirror is:
validate that `status` is a known literal (exactly like
`classes.timetable_status`), do **not** call, invoke, or fake a
WorkflowService integration, and flag the gap the same way both prior
services already do. Building a working approval gate here would be
inventing infrastructure this codebase has explicitly and repeatedly
deferred to Module 8 — not "mirroring the pattern," contradicting it.
This is called out explicitly in `financeService.js`'s own file-level
comment so it isn't mistaken for an oversight.

## What was built
`backend/src/services/financeService.js`:

- `createFeeStructure`/`updateFeeStructure`/`getFeeStructure`/
  `removeFeeStructure`/`listFeeStructuresForClassAndYear`/
  `listFeeStructures` — validation (required fields, known `status`
  literal) + audit logging on top of `financeRepository.js`, same
  shape as `academicService.js`'s `createClass`/`updateClass`.
  `removeFeeStructure` calls `financeRepository.softDelete`, never a
  hard delete (the repository has no such function at all).
- `markFeePayment`/`getFeePayment`/`listFeePaymentsForStudent`/
  `listFeePayments`/`removeFeePayment` — `markFeePayment` is a
  find-then-create/update upsert, same shape as
  `attendanceService.markAttendance`, but with **no** authorization/
  approval gate before it (this session's own explicit instruction).
  `status` is a required parameter here (unlike `fee_structures`,
  which has a sensible unattended default) — "mark paid/not-paid" is
  the entire point of the action, so omitting it is a caller bug worth
  surfacing, not something to default silently.
- Error classes mirror `academicService.js`'s/`attendanceService.js`'s
  own naming and mapping conventions exactly (`FeeStructureValidationError`,
  `FeeStructureStatusError`, `FeeStructureConflictError`,
  `FeeStructureClassNotFoundError`, `FeePaymentValidationError`,
  `FeePaymentStatusError`, `FeePaymentStudentNotFoundError`,
  `FeePaymentFeeStructureNotFoundError`, `FeePaymentConflictError`).
- `marked_by_user_id` is never separately validated against a real FK
  error — it's always the authenticated actor (`actorUserId`), never
  caller-supplied free text naming someone else, same precedent
  `attendance_sessions.marked_by_user_id` already set (no
  `AttendanceMarkedByNotFoundError` exists there either).
- `collegeId` is a direct parameter to `markFeePayment` (not derived
  from a lookup) — the dominant house convention every other `createX`
  in this codebase uses; `attendanceService.markAttendance`'s reuse of
  `cls.college_id` is the one exception, justified there by a lookup
  it already needed for authorization that `markFeePayment` has no
  equivalent of.

`backend/tests/finance-service.test.js`: unit tests, no live DB, same
`node:test` mock-based technique as `academic-service.test.js`/
`attendance-service.test.js` — trusts the constraint names already
live-verified in `326e8b5`/`c1b7aac` rather than re-running a live
database for a service layer that adds no new SQL of its own.

## Acceptance criteria
- Unit/integration tests at the same rigor as
  `academic-service.test.js`/`attendance-service.test.js`: every
  validation error, every constraint-violation mapping, every
  audit-log attribution, every no-op case (missing id, no recognized
  fields) covered.
- Full backend test suite still passes.
- No API/UI/`docs/` files touched.
- No repository or raw SQL calls from the service layer (CLAUDE.md
  rule 1) — verified by inspection: `financeService.js` only ever
  calls `financeRepository`/`feePaymentRepository`/`auditLogRepository`.
