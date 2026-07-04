# RESULT

## Files changed
- `backend/src/routes/finance.js` (new)
- `backend/src/tenantApp.js` (wired `createFinanceRouter()` in, after
  `createAttendanceRouter()`)
- `backend/tests/finance.test.js` (new)

No UI files touched — matches this slice's own API-only scope.

## What was built
Five endpoints under `/api/v1/finance/...`:

- `POST /finance/fee-structures` (`requireRole('principal')`) → `financeService.createFeeStructure`. 201.
- `PUT /finance/fee-structures/:id` (`requireRole('principal')`) → `financeService.updateFeeStructure`. 200, or 404 for an unknown id.
- `GET /finance/fee-structures` (`requireAuth`) → `class_id`+`academic_year` together (both required if either is given) calls `listFeeStructuresForClassAndYear`; neither given falls back to the plain paginated `listFeeStructures`.
- `POST /finance/fee-payments` (`requireRole('principal')`) → `financeService.markFeePayment`. 200 (upsert, same reasoning `attendance.js` uses for `markAttendance`).
- `GET /finance/fee-payments?student_id=...` (`requireAuth`, `student_id` required) → `financeService.listFeePaymentsForStudent`.

Every handler is a thin controller: field mapping (snake_case body →
camelCase service fields), a call into `financeService`, and error-class
→ HTTP-status mapping. No business logic, no repository calls, no raw
SQL — verified by inspection (`finance.js` imports only
`../services/financeService`, nothing from `../repositories/`).

## The `/finance/...` sub-prefix — a deliberate deviation, not an oversight
Every existing router (`classes.js`, `attendance.js`, `staff.js`,
`students.js`, `facultyAllocation.js`, `timetablePeriods.js`) mounts
flat (`/classes`, `/attendance`, no per-module path segment). This
session's own instruction explicitly asked for routes "under
`/api/v1/finance/...`," so `finance.js` mounts `/finance/fee-structures`
and `/finance/fee-payments` rather than flattening to match the
dominant convention. Called out in the router's own file-level comment
so a future reader doesn't mistake it for an inconsistency to "fix."
CLAUDE.md rule 5 is satisfied identically either way (app.js's outer
`/api/v1` mount is unchanged).

## Scope decision: no GET-by-id routes
This session's instruction named exactly five endpoints and did not
include a `GET /finance/fee-structures/:id` or
`GET /finance/fee-payments/:id` lookup — the one thing every other
router in this codebase has that this one doesn't. Not added
deliberately: nothing consumes it yet (no Finance UI exists at all —
restated from `326e8b5`), and the instruction was unusually specific
and itemized rather than a general "same as classes.js" framing. Flagged
here, not silently added as scope creep or silently omitted without
comment.

## Verification
1. **Integration tests** (`backend/tests/finance.test.js`, real HTTP
   requests against the live `docker-compose` Postgres, same technique
   as `classes.test.js`/`attendance.test.js`): 30 subtests, all passing —
   - `fee_structures` create: 201 with correct snake_case fields and
     the DB default `'Pending Approval'` status; 400 for a missing
     required field and for an unknown `status`; a real 409 from the
     live `fee_structures_college_year_class_category_key` constraint
     on a genuine duplicate; a real 404 for a nonexistent `class_id`;
     401 unauthenticated; 403 for a non-principal role.
   - `fee_structures` update: 200 with changed fields; 400 for an
     unknown `status`; 404 for a nonexistent id; 403 for a
     non-principal role.
   - `fee_structures` list: 400 when only one of `class_id`/
     `academic_year` is given; correct scoped results when both are
     given; the plain paginated fallback when neither is given; 401
     unauthenticated; a second tenant's plain list is empty (RLS holds
     end-to-end through the route).
   - `fee_payments` mark: 200 with correct snake_case fields
     (`marked_by_user_id` = the acting principal); re-marking the same
     `(student_id, fee_structure_id)` updates the existing row (same
     `id`), not a new one; 400 for a missing/unknown `status`; a real
     404 for a nonexistent `student_id` and for a nonexistent
     `fee_structure_id` (both live FK-violation mappings); 401
     unauthenticated; 403 for a non-principal role.
   - `fee_payments` list-by-student: 400 without `student_id`; correct
     results with it; 401 unauthenticated; a second tenant querying the
     first tenant's real `student_id` gets an empty list (RLS holds).
   - Audit attribution: create+update writes exactly two `audit_log`
     rows (`fee_structure_created`/`fee_structure_updated`, correct
     `entity`/`user_id`); mark+re-mark writes exactly two
     (`fee_payment_marked`/`fee_payment_remarked`).
2. **Full backend test suite**: `npm test` — **351/351 pass** (320
   prior + 31 new — the 30 finance subtests plus their one wrapping
   `test()` block), 0 failures.
3. Confirmed no leftover test data: `colleges`/`fee_structures`/
   `fee_payments` all `0` rows in the live database after the run
   (`t.after`'s `cleanupTenant` deletes `audit_log` →
   `fee_payments` → `fee_structures` → `students` → `classes` →
   `refresh_tokens` → `users` → `colleges`, respecting every FK
   direction).

## Flags / open questions
- **No real WorkflowService gate** — restated, unchanged from
  `8e5a3d5`: `fee_structures.status` accepts any known literal via a
  bare `PUT`, including a direct jump to `'Approved'`. This is the same
  gap `classes.timetable_status` already has; the route layer adds
  nothing new here, faithfully passing the service's own (documented)
  limitation through.
- **No `GET /finance/fee-structures/:id` or `GET /finance/fee-payments/:id`**
  — see above; add in a later slice once a real screen needs single-row
  fetches.
- **RBAC is a conservative placeholder** — `requireRole('principal')`
  for every write, same as every other not-yet-role-modeled write in
  this codebase. The real actor for "who may create/edit a fee
  structure" or "who may mark a student's fee paid" (accounts staff?
  class tutor?) is unnamed in BusinessRules.md; revisit once a real
  role model exists.
- **No Finance UI yet** — this slice is API-only, per its own scope.
- **Scholarship eligibility / `annual_income` field** — restated from
  every prior Finance slice's own RESULT.md: still fully unbuilt, still
  blocked on a Student-module migration that hasn't been asked for yet.
- **`receipt_document_id`'s FK is still deferred** — restated from
  `c1b7aac`: no `documents` table exists yet (Module 6 unbuilt). The
  route accepts any UUID for it, same as the service and repository
  layers already do.
