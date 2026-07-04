# TASK

## Objective
Module 5 (Finance), fourth vertical slice: API routes only — no UI.
Service layer already done (`8e5a3d5`) — `financeService.js` covers
`fee_structures` (no WorkflowService gate yet, deliberate per Module 8
not existing) and `fee_payments` (mark paid/not-paid).

## Scope (this session's own instruction)
- Routes under `/api/v1/finance/...` (CLAUDE.md rule 5), mirroring
  Academic/Attendance route conventions (auth middleware, tenant
  context, error handling patterns already established).
- `fee_structures`: create, update, list endpoints → call
  `financeService` only.
- `fee_payments`: mark paid/not-paid, list-by-student endpoints → call
  `financeService` only.
- No business logic in routes — thin controllers.

## Deliberate deviation, called out explicitly
Every existing router in this codebase (`classes.js`, `attendance.js`,
`staff.js`, `students.js`, `facultyAllocation.js`, `timetablePeriods.js`)
mounts flat — `/classes`, `/attendance`, no per-module path segment.
This session's own instruction explicitly asked for routes "under
`/api/v1/finance/...`" — a `/finance/` sub-prefix every other module
doesn't use. Followed literally (`/finance/fee-structures`,
`/finance/fee-payments`), not silently flattened to match the dominant
convention, since it was an explicit ask, not an oversight to correct.
CLAUDE.md rule 5 ("All API routes live under `/api/v1/`") is satisfied
identically either way — app.js's outer `/api/v1` mount, unchanged.

## Scope decision: no GET-by-id routes
This session's instruction enumerates exactly five endpoints — create/
update/list for `fee_structures`, mark/list-by-student for
`fee_payments` — and does not name a `GET /finance/fee-structures/:id`
or `GET /finance/fee-payments/:id` lookup, unlike every prior router in
this codebase (which all include one). Not added: the instruction is
unusually specific and itemized (unlike prior "same as classes.js"
framings), and nothing yet consumes such a lookup (no Finance UI
exists at all — see `326e8b5`'s own `.ai/RESULT.md`). Flagged here so a
future slice can add it deliberately if a real screen needs it, rather
than this one guessing at an unrequested shape.

## Key design decisions
- **RBAC**: `requireRole('principal')` gates every write (both
  `fee_structures` create/update and `fee_payments` mark), `requireAuth`
  gates every read — same deliberately conservative placeholder
  `classes.js`/`staff.js`/`students.js`/`facultyAllocation.js` already
  use, for the same reason: `financeService` has no authorization logic
  of its own (unlike `attendanceService.markAttendance`'s real
  `assertCanMark`), so the route is the only gate. `fee_payments`
  marking being "a simple write, no WorkflowService gate" (per this
  session's own framing for the *approval* question) is a separate
  question from *who* may perform it — BusinessRules.md names no
  specific actor (accounts clerk? class tutor?) for either write, so
  both get the same placeholder treatment every other not-yet-named
  actor gets in this codebase.
- **`fee_structures` list** accepts an optional `class_id` +
  `academic_year` pair (both together, or neither) — `financeService.listFeeStructuresForClassAndYear`
  takes both as required positional arguments, so a partial pair is
  rejected with 400 rather than silently ignored, same "reject an
  ambiguous partial filter" reasoning `facultyAllocation.js`'s own list
  route uses for its `class_id`/`staff_user_id` pair (inverted here:
  both-or-neither instead of exactly-one). Neither provided falls
  through to the plain paginated `listFeeStructures`, same shape
  `classes.js`'s own `GET /classes` uses.
- **`fee_payments` mark is `POST /finance/fee-payments`** (no `/mark`
  path segment) returning **200, not 201** — `markFeePayment` is a real
  mark-or-re-mark upsert, same reasoning `attendance.js`'s own
  `POST /attendance` uses for `markAttendance`.
- **`fee_payments` list is `GET /finance/fee-payments?student_id=...`**,
  `student_id` required — this is specifically the "list-by-student"
  endpoint named in scope, not a general/unscoped list (no such lookup
  exists on `financeService` either, matching `facultyAllocation.js`'s
  own "don't wrap what nothing needs yet" restraint).

## Files affected
- `backend/src/routes/finance.js` (new)
- `backend/src/tenantApp.js` (wired in, after `createAttendanceRouter()`
  — matches Roadmap.md's Attendance-before-Finance build order)
- `backend/tests/finance.test.js` (new)

## Acceptance criteria
- Integration tests at the same rigor as `classes.test.js`/
  `attendance.test.js`: real HTTP requests against a live Postgres,
  every error mapping proven against real DB constraints (not
  hand-thrown stand-ins), RBAC (401/403), cross-tenant isolation
  (RLS), audit-log attribution.
- Full backend test suite still passes.
- No business logic in routes — every handler only ever calls
  `financeService`, never a repository or raw SQL (verified by
  inspection).
