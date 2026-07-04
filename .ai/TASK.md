# TASK

## Objective
Module 3 (Academic), next vertical slice after `timetable_periods`/
`faculty_allocation` (`4fa8f12`): business logic over
`facultyAllocationRepository.js` — assign/list/remove a staff member's
allocation to a class+period, surfacing the migration's own DB-level
uniqueness/FK rules as real domain errors. No API/UI yet.

## Grounding (read before assuming any function list)
- `.ai/RESULT.md` (prior slice, `4fa8f12`) for
  `facultyAllocationRepository.js`'s exact shape/constraint names —
  this slice wires to those verbatim (`faculty_allocation_class_id_period_id_key`,
  `faculty_allocation_period_id_staff_user_id_key`, and the three FK
  constraint names, all already live-verified against a real database
  in that slice).
- `academicService.js` (the named pattern for
  `ClassNameConflictError`/`ClassTutorConflictError`/
  `ClassTutorNotFoundError`'s error-class-per-constraint style, domain
  errors instead of raw pg errors, audit-log entries, thin
  passthroughs for simple reads).
- `docs/architecture/Architecture.md` 2.5's Business Services table:
  "AcademicService | Academic year, semester, subjects, curriculum,
  **faculty allocation**, timetable" — stated outright, not inferred.

## Key design decision: extended academicService.js, not a new service file
The task left this open ("your call, document the reasoning"), but
Architecture.md 2.5 already settles it: "faculty allocation" is listed
by name as part of what `AcademicService` owns, in the same row as
"timetable." There is no ambiguity to resolve here — a new
`facultyAllocationService.js` would duplicate a boundary
Architecture.md already drew. Everything lives in `academicService.js`:
one new `require('../repositories/facultyAllocationRepository')`, six
new error classes, and five new exported functions, alongside the
existing `classes`-focused ones.

## Key design decision: only three verbs (assign/list/remove), no update
The task names exactly "assign/list/remove." `facultyAllocationRepository.update`
exists, and `classRepository`'s own precedent in this same file has a
full `updateClass`, but nothing here builds an
`updateFacultyAllocation`. Changing an existing allocation is
remove-then-assign, not an in-place edit — live-verified as a genuinely
working path (see `.ai/RESULT.md`), not just asserted. If a future
slice's real usage pattern turns out to need in-place update (e.g. to
preserve the row's `id`/`created_at` across a reassignment, or to avoid
two audit-log entries for one logical change), that's a small, easy
addition then — not worth guessing at now against a task that named
three verbs, not four.

## Key design decision: assignFacultyAllocation requires staffUserId, even though the DB column is nullable
`faculty_allocation.staff_user_id` is nullable at the DB level
specifically to represent non-teaching slots (`"Lunch"`/`"Library"`/
`"Sports"` cells from the free-text grid, per the prior slice's own
design decision) with a `subject` label but no staff. This slice's
task, though, is framed as "assign **a staff member's** allocation" —
so `assignFacultyAllocation` validates `staffUserId` as required,
rejecting its absence with `FacultyAllocationValidationError` before
ever touching the DB. Recording a non-teaching slot (a `subject` with
no staff) is a different, unaddressed operation this function
deliberately does not serve — the DB schema stays more permissive than
this one service function, the same relationship `timetable_status`
has with its own service-level (not DB-level) `CHECK`.

## Key design decision: no authorization check in this slice
BusinessRules.md's "Class Tutor is assigned only by HOD" names a
specific actor for a specific action, which is why `assignFacultyAllocation`'s
sibling `createClass`/`updateClass` still don't enforce it (left to the
route/RBAC layer) — but crucially, BusinessRules.md names **no** actor
at all for "who may assign faculty to a period." Unlike
`attendanceService.markAttendance` (which built a real authorization
check because the task explicitly named the eligible actors to
enforce), nothing here specifies who should be allowed to call
`assignFacultyAllocation`/`removeFacultyAllocation` — so nothing is
invented. Same "route/RBAC layer once an API exists" deferral every
other `classes`/`staff`/`students` write already carries.

## Files likely affected
- `backend/src/services/academicService.js` (extended)
- `backend/tests/academic-service.test.js` (extended)

## Exact changes

**`academicService.js`**:
- New error classes: `FacultyAllocationValidationError` (missing
  `classId`/`periodId`/`subject`/`staffUserId`),
  `FacultyAllocationClassNotFoundError`,
  `FacultyAllocationPeriodNotFoundError`,
  `FacultyAllocationStaffNotFoundError` (the three FK constraints),
  `FacultyAllocationPeriodTakenError` (`faculty_allocation_class_id_period_id_key`,
  23505 — this class already has an assignment for this period),
  `FacultyAllocationStaffConflictError`
  (`faculty_allocation_period_id_staff_user_id_key`, 23505 — this
  staff member is already teaching a different class during this
  period).
- `assignFacultyAllocation(client, { collegeId, classId, periodId,
  subject, staffUserId }, { actorUserId } = {})` — validates all four
  fields required, maps all five constraint violations above, writes
  a `faculty_allocation_assigned` audit entry.
- `getFacultyAllocation(client, id)` — thin passthrough, `null` means
  not found.
- `listFacultyAllocationsForClass(client, classId)` — thin passthrough
  to `findByClassId` (a class's full teaching schedule).
- `listFacultyAllocationsForStaff(client, staffUserId)` — thin
  passthrough to `findByStaffUserId` (a staff member's full teaching
  schedule — the real, structured link `attendanceService`'s own
  "scheduled staff member" gap, `82f8479`, will eventually need; still
  not wired into that check in this slice, only exposed).
- `removeFacultyAllocation(client, id, { actorUserId } = {})` — looks
  the row up first (for `collegeId` on the audit entry and to skip
  logging a no-op), hard `DELETE` (matches `timetable_periods`/
  `faculty_allocation`'s own open-question soft-delete treatment, not
  `attendance_sessions`'s resolved one), audit entry only if a row
  existed.

## Acceptance criteria
- `assignFacultyAllocation` rejects any missing required field
  (including `staffUserId`) without calling the repository.
- All five constraint violations
  (`faculty_allocation_class_id_period_id_key`,
  `faculty_allocation_period_id_staff_user_id_key`, and the three FK
  constraints) map to their named domain errors — live-verified
  against real Postgres errors from the actual constraints, not just
  hand-thrown ones in a unit test.
- A second class can share the same period with a *different* staff
  member (the "shared period" design from the prior slice), proven
  live through this service, not just at the repository layer.
- A non-conflict repository error passes through unchanged.
- `removeFacultyAllocation` writes an audit entry only when a row
  existed; is idempotent against a second call on the same id.
- Remove-then-assign for the same `(classId, periodId)` succeeds after
  the original row is removed — proves the "no update function"
  design decision is a real, working path, not just an assertion.
- No API route, UI, or authorization logic in this slice.
- Full backend suite passes with no regressions (218 tests: 203
  pre-existing + 15 new here — 14 new subtests plus a second
  top-level `test()` block added to `academic-service.test.js`, which
  `node:test`'s summary counts alongside its subtests — see
  `.ai/RESULT.md`).
