# RESULT

## Files changed
- `backend/src/services/academicService.js` (extended)
- `backend/tests/academic-service.test.js` (extended)

## What changed, per file
- `academicService.js`: added `require('../repositories/facultyAllocationRepository')`,
  six new error classes (`FacultyAllocationValidationError`,
  `FacultyAllocationClassNotFoundError`,
  `FacultyAllocationPeriodNotFoundError`,
  `FacultyAllocationStaffNotFoundError`,
  `FacultyAllocationPeriodTakenError`,
  `FacultyAllocationStaffConflictError`), and five new functions:
  `assignFacultyAllocation`, `getFacultyAllocation`,
  `listFacultyAllocationsForClass`, `listFacultyAllocationsForStaff`,
  `removeFacultyAllocation`. Extended the existing file rather than
  creating a new service — Architecture.md 2.5's Business Services
  table already lists "faculty allocation" as part of what
  AcademicService owns, in the same row as "timetable"; no new
  boundary to invent.
  - `assignFacultyAllocation` validates `classId`/`periodId`/`subject`/
    `staffUserId` are all present (deliberately requiring
    `staffUserId` even though the DB column is nullable — this
    function is specifically "assign *a staff member's* allocation";
    recording a non-teaching slot with no staff is a different,
    unaddressed operation), then maps all five constraint violations
    the prior slice's migration already guarantees to their named
    domain errors, and writes a `faculty_allocation_assigned` audit
    entry.
  - No `updateFacultyAllocation` — the task named exactly
    "assign/list/remove." Changing an allocation is remove-then-assign,
    live-verified as a genuinely working path (see Tests below), not
    just asserted to be one.
  - No authorization check — unlike `attendanceService.markAttendance`
    (which built one because the task explicitly named eligible
    actors to enforce), BusinessRules.md names no actor at all for
    "who may assign faculty to a period." Left to the route/RBAC layer
    once an API exists, same deferral every other `classes` write in
    this same file already carries.
- `academic-service.test.js`: added a second top-level `test()` block
  (14 new subtests) covering validation, all five constraint mappings,
  the three thin-passthrough reads, and `removeFacultyAllocation`'s
  no-op/audit behavior — same no-DB, stubbed-repository technique as
  every existing test in this file.

## Tests
Two layers, matching the discipline established since Module 3's
second slice (`70b6e68`) and continued through
`attendanceService.js`/`facultyAllocationRepository.js`:

**Unit tests** (extended `academic-service.test.js`, no DB —
`node:test`'s `t.mock.method` stubs `facultyAllocationRepository`/
`auditLogRepository`): 14 new subtests, all passing — two missing-field
validation cases (including the deliberately-required `staffUserId`),
successful create with audit attribution, all five constraint
violations mapped from hand-thrown `err.code`/`err.constraint`, a
non-conflict error passthrough, the three thin-passthrough reads, and
`removeFacultyAllocation`'s no-op-on-missing-id / real-delete-with-audit
cases. What's deliberately not here: the five constraint violations
reaching their domain errors through genuine Postgres errors — that
needs a real database, done instead in the live verification below
(the prior slice's own `.ai/RESULT.md` already proved these exact
constraint names fire correctly against a real database; this file
trusts that grounding for the unit-test layer, same reasoning
`academic-service.test.js`'s original header comment already states
for `classes`' own constraints).

**Live verification** against the real, already-running Docker
Postgres (`arcnave-blueprint-db-1` — had stopped since the last
session yet again; `docker start` brought it back with all Module 0-4
data intact on its persistent volume). Seeded a real tenant with two
staff users, two classes, and two shared timetable periods:

- **Real create + audit** — PASS: a genuine `faculty_allocation` row
  created through the service, with exactly one `audit_log` row,
  `action: 'faculty_allocation_assigned'`, `entity: 'faculty_allocation'`,
  correctly attributed to the actor.
- **Real `faculty_allocation_class_id_period_id_key` conflict** —
  PASS: re-assigning a different subject/staff to the same
  `(classId, periodId)` raised a genuine Postgres `23505`, mapped to
  `FacultyAllocationPeriodTakenError`.
- **Real `faculty_allocation_period_id_staff_user_id_key` conflict** —
  PASS: assigning an already-teaching staff member to a *different*
  class during the same period raised a genuine `23505`, mapped to
  `FacultyAllocationStaffConflictError`.
- **Real FK violations, all three** — PASS: nonexistent `classId`,
  `periodId`, and `staffUserId` each raised the correct named FK
  constraint, mapped to `FacultyAllocationClassNotFoundError`/
  `FacultyAllocationPeriodNotFoundError`/
  `FacultyAllocationStaffNotFoundError` respectively.
- **Shared-period design proven through the service** — PASS: a
  *second* class was successfully assigned a *different* staff member
  for the exact same period row — the "shared bell schedule" design
  from the prior slice, working end-to-end through this service layer,
  not just at the repository layer.
- **`staffUserId` required here even though the DB allows `NULL`** —
  PASS: calling `assignFacultyAllocation` with a `subject` but no
  `staffUserId` was rejected with `FacultyAllocationValidationError`
  before reaching the database at all.
- **Reads** — PASS: `getFacultyAllocation`/
  `listFacultyAllocationsForClass`/`listFacultyAllocationsForStaff` all
  returned correct data against the live rows — `listFacultyAllocationsForStaff`
  in particular returned exactly that staff member's one real
  allocation, concrete (if still unconsumed) proof this is the link a
  future `attendanceService` slice can use.
- **`removeFacultyAllocation`** — PASS: deleted a real row, wrote a
  correctly-attributed `faculty_allocation_removed` audit entry
  (`audit_log` now had exactly two rows for that allocation id — the
  `assigned` one from creation, then `removed`), and was idempotent on
  a second call (returned `null`, no second audit entry).
- **Remove-then-assign proven as a real, working path** — PASS: after
  removing an allocation, assigning a fresh subject/staff to the exact
  same `(classId, periodId)` succeeded with a new row id — confirms
  the "no update function" design decision doesn't leave the slot
  permanently stuck.
- All seeded data cleaned up afterward.

Ran the full backend suite (`npm test`): **218/218 pass** (203
pre-existing + 15 new — 14 new subtests plus a second top-level
`test()` block in `academic-service.test.js`, which `node:test`'s
summary line counts alongside its subtests), no regressions.

## Flags / open questions
- **`listFacultyAllocationsForStaff` still isn't wired into
  `attendanceService.assertCanMark`** — this slice only exposes the
  link; closing the "scheduled staff member" authorization gap
  (`82f8479`) needs a future Attendance (or Academic) slice to actually
  call it and use the result. Not attempted here — this slice's scope
  is business logic over `facultyAllocationRepository` only.
- **No CSV-upload-to-normalized-rows population path** — unchanged
  from the prior slice's own flag: `TutorClass.jsx`'s timetable upload
  still only writes `classes.timetable_data`; deciding how (or
  whether) an upload also populates `faculty_allocation` is real
  `AcademicService` business logic for a later slice.
- **No update function** — deliberate, see design decision above;
  revisit only if a real future consumer's usage pattern shows
  remove-then-assign is genuinely insufficient (e.g. audit-log noise,
  or a need to preserve the row's original id across a reassignment).
- **No authorization check** — deferred to the route/RBAC layer once
  an API exists, same as every other `classes`/`staff`/`students`
  write in this codebase; BusinessRules.md names no specific actor for
  this action, unlike Class Tutor assignment.
- **No API route, UI, or `docs/modules/` file touched in this slice**
  — matches every prior service-layer slice's own scope exactly.
