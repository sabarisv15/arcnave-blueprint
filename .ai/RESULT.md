# RESULT

## Files changed
- `backend/src/services/academicService.js` (extended)
- `backend/src/services/attendanceService.js` (rename call site updated)
- `backend/src/routes/facultyAllocation.js` (new)
- `backend/src/routes/timetablePeriods.js` (new)
- `backend/src/tenantApp.js` (two new routers wired in)
- `backend/tests/academic-service.test.js` (extended, +11 subtests)
- `backend/tests/attendance-service.test.js` (mocks renamed, no behavior change)
- `backend/tests/faculty-allocation.test.js` (new, 20 subtests)
- `backend/tests/timetable-periods.test.js` (new, 13 subtests)

## What changed, per file
- `academicService.js`: added `TimetablePeriodValidationError`,
  `TimetablePeriodSlotTakenError`, `TimetablePeriodInUseError`, and
  `createTimetablePeriod`/`getTimetablePeriod(id)`/
  `listTimetablePeriods`/`removeTimetablePeriod` — the CRUD surface
  `576ca6b` never needed (it only ever wanted one internal day/hour
  lookup). Renamed that lookup, `getTimetablePeriod(collegeId,
  dayOfWeek, hourIndex)` -> `getTimetablePeriodByDayAndHour`, freeing
  `getTimetablePeriod(id)` for the standard by-id shape every other
  `getX` in this file uses.
- `attendanceService.js`: updated its one call site
  (`assertCanMark`) and its own comments to the renamed function.
- `routes/facultyAllocation.js`: five endpoints under
  `/faculty-allocation`, mirroring `routes/classes.js`'s shape exactly
  — snake<->camel body translation, `mapAcademicServiceError` covering
  all five faculty-allocation error classes, the same RBAC placeholder.
  `GET /faculty-allocation` requires exactly one of `class_id`/
  `staff_user_id` (400 otherwise), dispatching to
  `listFacultyAllocationsForClass`/`listFacultyAllocationsForStaff`.
- `routes/timetablePeriods.js`: four endpoints under
  `/timetable-periods`, same shape. `DELETE` maps the FK-RESTRICT
  case (a period still referenced by a `faculty_allocation` row) to
  409 via `TimetablePeriodInUseError`.
- `tenantApp.js`: both routers registered alongside `classes`, same
  block, same order (after `tenantMiddleware`).

## No UI in this slice — confirmed, not assumed
Ran a dedicated `Explore` search of `frontend/src` before deciding
this, rather than reusing an earlier slice's assumption. Every
"period"/"slot" reference across `TutorClass.jsx`, `HodDashboard.jsx`,
`PrincipalDashboard.jsx`, `StaffDashboard.jsx`, and
`TutorClassMonitor.jsx` is derived by parsing
`classes.timetable_data`'s free-text CSV grid client-side — zero
references anywhere to `academicService`'s new functions,
`timetable_periods`, `faculty_allocation`, or any structured
period/allocation UI (no filenames like `*Period*`/`*Allocation*`
either). Matches the precedent `timetable_data`'s own read-only,
grid-based repoint already set (Module 3's fourth slice). No screen
needs this API today.

## A real risk caught by renaming, and how it was handled safely
Renaming `getTimetablePeriod` (day/hour lookup) to
`getTimetablePeriodByDayAndHour` is a genuinely dangerous kind of
change in this codebase: JavaScript doesn't enforce function arity, so
a stale caller still invoking the old name with `(collegeId,
dayOfWeek, hourIndex)` — if a new `getTimetablePeriod(id)` existed
under that same old name — would silently call the wrong function
with the wrong argument count instead of throwing. Handled by grepping
for every call site (`attendanceService.js`'s one real call, plus its
own test file's five mocks) and updating all of them in the same
change, then proving nothing was missed via the full unit-test suite
(which would have failed loudly — `academicService.getTimetablePeriodByDayAndHour`
being unmocked in a stubbed test hits a real, unstubbed function
against a fake `{}` client, throwing) before ever touching the live
database.

## Tests
Two layers, same discipline as every prior slice.

**Unit tests** (extended `academic-service.test.js`): 11 new subtests
covering `createTimetablePeriod` validation/success/conflict/passthrough
error, the three passthrough reads
(`getTimetablePeriod`/`getTimetablePeriodByDayAndHour`/
`listTimetablePeriods`), and `removeTimetablePeriod`'s no-op/success/
`TimetablePeriodInUseError` cases. `attendance-service.test.js`'s five
existing mocks renamed to match; behavior unchanged, still 20 subtests
passing.

**Live integration tests** against the real, already-running Docker
Postgres (`arcnave-blueprint-db-1`, up throughout this session):

- `timetable-periods.test.js` (13 subtests, all passing): create +
  snake_case response, validation (400), duplicate-slot conflict
  (real `23505` on `timetable_periods_college_id_day_of_week_hour_index_key`
  -> 409), get by id (200/404), list + limit, delete (204, then 404),
  **delete-while-referenced** (a real `faculty_allocation` row seeded
  directly, then the period delete attempt genuinely raises `23503`
  on `faculty_allocation_period_id_fkey` -> 409, not a 500), RBAC
  (403/401 on writes, 200 for staff reads, 401 unauthenticated reads),
  cross-tenant isolation (same day/hour slot independently usable in
  two tenants), and audit attribution.
- `faculty-allocation.test.js` (20 subtests, all passing): create +
  snake_case response, validation (400), the real duplicate
  `(class_id, period_id)` conflict (409), the real staff
  double-booking conflict across two different classes (409), all
  three real FK violations (404 each), **the shared-period design
  proven through the route layer** (a second class assigned a
  different staff member for the identical period succeeds), get by
  id (200/404), list requiring exactly one of `class_id`/
  `staff_user_id` (400 for neither and for both), list scoped
  correctly by each, delete (204, then 404), RBAC, cross-tenant
  isolation, and audit attribution. One test-authoring bug was caught
  and fixed during this work (not a route bug): the cross-tenant test
  originally reused a class/period pair already consumed by an earlier
  subtest in the same file, causing a real double-conflict and an
  `undefined` id flowing into a follow-up request — fixed by seeding a
  fresh, dedicated class/period for that one test.

Ran the full backend suite (`npm test`): **268/268 pass** (221
pre-existing + 47 new), no regressions.

## Flags / open questions
- **Still no CSV-upload-to-normalized-rows population path** —
  unchanged from every prior flag on this topic: nothing in the real
  frontend populates these tables through this new API yet either
  (no UI calls it — see above). A principal/HOD would need to call
  this API directly (e.g. via a future admin tool, or a future UI
  slice if a real screen ever needs one) to make
  `attendanceService`'s "scheduled staff member" check reachable in
  practice.
- **RBAC is still the same conservative placeholder** every Module 3
  route carries — `requireRole('principal')` for writes, not a
  final decision, same open item as `classes.js`/`staff.js`.
- **No update endpoint on either resource** — matches
  `academicService.js`'s own `assignFacultyAllocation`/faculty-allocation
  precedent (remove-then-assign, not in-place edit); `timetable_periods`
  follows the same shape for consistency, not independently decided.
- **No `docs/modules/` file touched** — matches every prior Module 3
  API slice's own scope.
