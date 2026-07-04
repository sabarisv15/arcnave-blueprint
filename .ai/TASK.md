# TASK

## Objective
Module 3 (Academic): API routes for `faculty_allocation`
(`/api/v1/faculty-allocation`) and `timetable_periods`
(`/api/v1/timetable-periods`), following the existing
`/api/v1/classes` pattern (`235aa8b`). Closes the gap `576ca6b`
flagged: nothing could populate these tables via any real API yet, so
`attendanceService`'s newly-wired "scheduled staff member" check was
real code with no real way to become true. No UI — checked first
(see below), nothing invents one.

## Grounding (read before assuming any route shape)
- `.ai/RESULT.md`/`.ai/TASK.md` (`8b66a4c` — the service layer this
  needs): `academicService.js` already had `assignFacultyAllocation`/
  `getFacultyAllocation`/`listFacultyAllocationsForClass`/
  `listFacultyAllocationsForStaff`/`removeFacultyAllocation`, but nothing
  for `timetable_periods` beyond the single internal
  `getTimetablePeriodByDayAndHour` lookup `576ca6b` added for
  `attendanceService`'s own use — no way to *create* a period existed
  anywhere in this codebase before this slice.
- `routes/classes.js` (the named pattern): `requireResolvedTenant`
  guard, a `*_BODY_FIELDS` snake<->camel array local to the route file,
  `mapXServiceError` returning a boolean so the catch block can `throw
  err` for anything unmapped, responses left in the repository's
  native snake_case, `requireRole('principal')` on writes /
  `requireAuth` on reads (the same conservative placeholder every
  Module 3 route already carries, not a final decision).
- A dedicated `Explore` search of `frontend/src` (this slice's own
  research, not reused from an earlier one) confirmed: every "period"/
  "slot" concept in the real, working frontend
  (`TutorClass.jsx`/`HodDashboard.jsx`/`PrincipalDashboard.jsx`/
  `StaffDashboard.jsx`/`TutorClassMonitor.jsx`) is derived by parsing
  `classes.timetable_data`'s free-text grid client-side — zero
  references anywhere to `academicService`, `timetable_periods`,
  `faculty_allocation`, or any structured period/allocation UI. No
  screen needs this API today — confirmed, not assumed. Matches the
  precedent `timetable_data`'s own read-only, grid-based repoint
  already set. **No UI built in this slice.**

## Key design decision: timetable_periods needed real CRUD added to academicService.js first, before any route could exist
`576ca6b` only needed (and only built) a single read lookup for
`attendanceService`'s internal use — there was no `createTimetablePeriod`,
no plain `getTimetablePeriod(id)`, no `listTimetablePeriods`, no
`removeTimetablePeriod` anywhere. "List/manage periods" (this slice's
own ask) isn't reachable without those, so this slice adds them to
`academicService.js` first, same file, same reasoning `8b66a4c`
already gave for faculty allocation living there (Architecture.md 2.5
lists both "faculty allocation" and "timetable" under AcademicService).

## Key design decision: renamed the existing day/hour lookup to avoid a naming collision
`576ca6b` named its lookup `getTimetablePeriod(client, collegeId,
dayOfWeek, hourIndex)`. Every other `getX` in this file
(`getClass`/`getFacultyAllocation`) takes a single `id` — the natural,
consistent name for the new by-id lookup a route needs is
`getTimetablePeriod(client, id)`, which collides with the existing
three-argument function. Resolved by renaming the existing lookup to
`getTimetablePeriodByDayAndHour` (more explicit about what it actually
does anyway) and adding the simple by-id `getTimetablePeriod(client,
id)` fresh, keeping the by-id convention consistent across the file
rather than making the new function the oddly-named one.
`attendanceService.js`'s call site and its own test file's mocks were
updated to the new name — verified live and via the full unit-test
suite that nothing was left calling the old name silently with the
wrong arguments (a real risk here: JS doesn't enforce arity, so a
stale call to the renamed 4-argument-shaped function against the new
1-argument function would have silently misbehaved rather than
throwing).

## Key design decision: removeTimetablePeriod maps the FK RESTRICT case to a real domain error
Deleting a `timetable_periods` row still referenced by a
`faculty_allocation` row hits Postgres's default RESTRICT (no `ON
DELETE` override exists — house convention, per the migration's own
`.ai/TASK.md`) and raises a real `23503` on
`faculty_allocation_period_id_fkey`. `removeTimetablePeriod` maps this
to `TimetablePeriodInUseError` (409 at the route layer) rather than
letting a raw constraint-violation 500 reach a caller — this is the
one `removeX` in `academicService.js` that needs a `try/catch` at all,
since nothing else in this schema is referenced the way
`faculty_allocation` FKs into `timetable_periods`.
`removeFacultyAllocation` needed no equivalent change: nothing FKs
into `faculty_allocation`.

## Key design decision: no plain "list all" faculty-allocation route
`academicService.js` only ever exposed the two lookups a known
consumer needs (`listFacultyAllocationsForClass`/
`listFacultyAllocationsForStaff`), matching its own established
"wrap only what's needed" precedent. `GET /faculty-allocation`
requires exactly one of `class_id`/`staff_user_id` as a query
parameter (400 if neither or both), dispatching to the matching
service function — no unscoped, tenant-wide listing exists at either
layer.

## Files likely affected
- `backend/src/services/academicService.js` (extended: timetable_periods
  CRUD + the getTimetablePeriodByDayAndHour rename)
- `backend/src/services/attendanceService.js` (call site updated for
  the rename)
- `backend/src/routes/facultyAllocation.js` (new)
- `backend/src/routes/timetablePeriods.js` (new)
- `backend/src/tenantApp.js` (two new routers wired in)
- `backend/tests/academic-service.test.js` (extended)
- `backend/tests/attendance-service.test.js` (mocks renamed)
- `backend/tests/faculty-allocation.test.js` (new)
- `backend/tests/timetable-periods.test.js` (new)

## Exact changes

**`academicService.js`**: three new error classes
(`TimetablePeriodValidationError`, `TimetablePeriodSlotTakenError`,
`TimetablePeriodInUseError`) and four new functions —
`createTimetablePeriod`, `getTimetablePeriod(id)`,
`listTimetablePeriods`, `removeTimetablePeriod` — same
validate/map-constraints/audit-log shape as every other write in this
file. `getTimetablePeriodByDayAndHour` is the renamed prior lookup.

**`routes/facultyAllocation.js`**: `POST /faculty-allocation` ->
`assignFacultyAllocation`, `GET /faculty-allocation/:id` ->
`getFacultyAllocation` (404 if null), `GET /faculty-allocation` ->
`listFacultyAllocationsForClass`/`listFacultyAllocationsForStaff`
dispatched on `class_id`/`staff_user_id` query params (400 if neither
or both), `DELETE /faculty-allocation/:id` -> `removeFacultyAllocation`
(204/404). Error mapping: `FacultyAllocationValidationError` -> 400;
`FacultyAllocationPeriodTakenError`/`FacultyAllocationStaffConflictError`
-> 409; `FacultyAllocationClassNotFoundError`/
`FacultyAllocationPeriodNotFoundError`/
`FacultyAllocationStaffNotFoundError` -> 404.

**`routes/timetablePeriods.js`**: `POST /timetable-periods` ->
`createTimetablePeriod`, `GET /timetable-periods/:id` ->
`getTimetablePeriod`, `GET /timetable-periods` -> `listTimetablePeriods`
(limit/offset passthrough, same as classes.js), `DELETE
/timetable-periods/:id` -> `removeTimetablePeriod`. Error mapping:
`TimetablePeriodValidationError` -> 400;
`TimetablePeriodSlotTakenError`/`TimetablePeriodInUseError` -> 409.

**`tenantApp.js`**: both routers registered in the same block as
`classes`, after `tenantMiddleware`.

## Acceptance criteria
- All endpoints reachable against a real running server + live
  Postgres, not mocked request/response pairs.
- Every domain error from `academicService.js` maps to the correct
  HTTP status, proven with genuine Postgres constraint violations
  (duplicate slot, duplicate class+period, staff double-booking, all
  three FK violations, the FK-RESTRICT-on-delete case) — not
  hand-thrown ones.
- The "shared period" design (two different classes' allocations
  pointing at the same `timetable_periods` row) works through the
  route layer, not just the repository/service layers already proven
  in prior slices.
- Deleting a period still referenced by a `faculty_allocation` row
  returns 409, not a 500.
- `GET /faculty-allocation` requires exactly one of
  `class_id`/`staff_user_id`; both or neither is a 400.
- RBAC and cross-tenant isolation match every other Module 3 route
  exactly.
- Audit log entries correctly attributed on every create.
- No UI — confirmed via dedicated frontend research this slice ran
  itself, not assumed.
- Full backend suite passes with no regressions (268 tests: 221
  pre-existing + 47 new).
