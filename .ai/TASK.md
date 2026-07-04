# TASK

## Objective
Module 4 (Attendance): API routes for `attendance_sessions` —
`/api/v1/attendance` — wiring `attendanceService.markAttendance` and
its two reads, following Module 3's route/error-mapping conventions
(`routes/classes.js`, `235aa8b`; `routes/facultyAllocation.js`,
`e36bfb8`). This is the last piece needed to prove, end-to-end from a
real HTTP request, that all three of BusinessRules.md's eligible
attendance markers actually work — the "scheduled staff" leg in
particular, closed at the service layer in `576ca6b` but never
exercised through a route until now.

## Grounding (read before assuming any route shape)
- `.ai/RESULT.md`/`.ai/TASK.md` (`576ca6b`) for `attendanceService.js`'s
  exact function signatures, error classes, and — critically — the
  fact that `markAttendance` requires **both** `actorUserId` and
  `actorRole`, unlike every other service's create function (which
  only needs `actorUserId`, for audit attribution). `assertCanMark`
  needs the role to evaluate the HOD leg.
- `routes/classes.js`/`routes/facultyAllocation.js` (the named
  patterns): `requireResolvedTenant` guard, a `*_BODY_FIELDS`
  snake<->camel array local to the route file, `mapXServiceError`
  returning a boolean so the catch block can `throw err` for anything
  unmapped, responses left in the repository's native snake_case.
- `attendanceRepository.js`/the Module 4 first slice (`49c8b4b`):
  `attendance_sessions` is soft-delete only, and no `removeX`/`softDelete`
  wrapper exists anywhere above the repository layer — there is
  nothing for a `DELETE` route to call.

## Key design decision: this route does NOT use requireRole('principal') for writes — the one real departure from every other Module 3/4 route
Every route so far (`classes`, `staff`, `students`,
`faculty-allocation`, `timetable-periods`) gates writes with
`requireRole('principal')` as a deliberately conservative placeholder,
specifically *because* their underlying services have no
fine-grained authorization logic of their own — the route is the only
gate that exists. `attendanceService.markAttendance` is different: it
already enforces BusinessRules.md's real rule itself (class tutor, HOD
force-mark, or the staff member genuinely scheduled for the period —
`assertCanMark`, `576ca6b`), throwing `AttendanceForbiddenError` for
anyone else. Gating `POST /attendance` with `requireRole('principal')`
on top of that would be actively wrong, not just redundant — it would
lock out every actor BusinessRules.md actually names as eligible
(ordinary teaching staff and class tutors are not principals),
defeating the entire point of the service-layer work already done.
`POST /attendance` uses `requireAuth` only (any authenticated tenant
user may attempt to mark; the service decides who succeeds), with
`AttendanceForbiddenError` mapped to a 403 — the real authorization
decision lives in exactly one place, not duplicated or second-guessed
at the route.

## Key design decision: POST returns 200, not 201
`markAttendance` is a real create-or-update (mark-or-re-mark) action —
`StaffDashboard.jsx`'s own "Mark Attendance"/"Update Attendance"
button is the same handler either way (per `576ca6b`'s own grounding).
The service's return value doesn't distinguish which happened, so
there's no clean signal to key a conditional 201-vs-200 off of without
changing `markAttendance`'s own contract, which this slice doesn't do
— that function is already built, tested, and live-verified;
touching it isn't this slice's job. `200` uniformly for both branches
is the honest, simplest choice.

## Key design decision: no DELETE route
`attendance_sessions` is soft-delete only per BusinessRules.md's AI
section, and real deletion is an approval-gated action ("even with
approval") — `WorkflowService` (Module 8) doesn't exist yet.
`attendanceService.js` itself exposes no `softDelete`/`removeX`
wrapper over `attendanceRepository.softDelete` — nothing exists for a
route to call. Building one now would mean inventing both the service
wrapper and the approval gate in the same breath, the same "don't
invent structure nobody asked for yet" restraint applied everywhere
else in this codebase.

## Key design decision: GET /attendance requires both class_id and session_date
Unlike `facultyAllocation.js`'s list route (exactly one of two
filters, an either/or choice), `attendanceService.listAttendanceSessionsForClassAndDate`
takes both `classId` and `sessionDate` as required positional
arguments — there's no service function that accepts just one. The
route validates both are present (400 otherwise) rather than
inventing a third listing shape the service doesn't support.

## Files likely affected
- `backend/src/routes/attendance.js` (new)
- `backend/src/tenantApp.js` (one new `require` + one new `app.use`)
- `backend/tests/attendance.test.js` (new)

## Exact changes

**`routes/attendance.js`**:
- `ATTENDANCE_BODY_FIELDS`: `class_id`/`session_date`/`hour_index`/
  `absent_student_ids`/`total_students` <-> their camelCase service
  fields. `college_id` absent (always `req.collegeId`).
  `absent_student_ids` passed through as the raw JSON array
  `express.json()` already parsed — `attendanceService.markAttendance`
  is the one that `JSON.stringify`s it before the repository call, not
  this route.
- `mapAttendanceServiceError`: `AttendanceValidationError` -> 400;
  `AttendanceClassNotFoundError` -> 404;
  `AttendanceTimetableNotApprovedError`/`AttendanceLockedError`/
  `AttendanceSessionConflictError` -> 409 (same "resource not in the
  right state" semantics `ClassNameConflictError`/
  `FacultyAllocationPeriodTakenError` already use 409 for elsewhere);
  `AttendanceForbiddenError` -> 403.
- `POST /attendance` (`requireAuth`) -> `markAttendance`, with
  `actorUserId: req.jwtClaims.sub` **and** `actorRole:
  req.jwtClaims.role` — the one route in this codebase that needs to
  pass the actor's role into a service call for a real authorization
  decision, not just RBAC gating. Returns 200.
- `GET /attendance/:id` (`requireAuth`) -> `getAttendanceSession`, 404
  if `null`.
- `GET /attendance` (`requireAuth`) -> `listAttendanceSessionsForClassAndDate`,
  requiring both `class_id` and `session_date` query params (400 if
  either missing).
- No `DELETE` route (see design decision above).

**`tenantApp.js`**: `require('./routes/attendance')` +
`app.use(createAttendanceRouter())`, same block/order as every other
Module 3/4 route.

## Acceptance criteria
- All three of BusinessRules.md's eligible markers work through a
  real HTTP request against a live Postgres: class tutor, HOD
  force-mark, and — the key proof this slice exists for — the staff
  member genuinely scheduled for the period, verified against a real
  seeded `faculty_allocation`/`timetable_periods` row, not a mock.
- An unrelated staff member (none of the three) gets a real 403, not
  a 500 or a silent 200.
- `AttendanceTimetableNotApprovedError`/`AttendanceLockedError`/
  `AttendanceSessionConflictError` all map to 409, proven live
  (including the locked-session case, reached the same way
  `attendanceService.js`'s own tests reach it: a direct `UPDATE`
  against `locked_at`, since no real code path can set it yet).
- Re-marking the same `(class, date, hour)` updates the existing row
  (same id), proven through the route, not just the service layer
  already proven in `576ca6b`.
- `GET /attendance` requires both `class_id` and `session_date`; both
  missing and either-missing all correctly 400.
- `POST /attendance` requires only authentication, not a specific
  role — proven by an HOD and an ordinary scheduled staff member (not
  a principal) both successfully marking attendance.
- Cross-tenant isolation and audit attribution (including the
  `attendance_marked` vs `attendance_remarked` action-name
  distinction) match every other Module 3/4 route's own proof.
- No `DELETE /attendance` route exists.
- Full backend suite passes with no regressions (285 tests: 268
  pre-existing + 17 new).
