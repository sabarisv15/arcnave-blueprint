# RESULT

## Files changed
- `backend/src/routes/attendance.js` (new)
- `backend/src/tenantApp.js` (one router wired in)
- `backend/tests/attendance.test.js` (new, 17 subtests)

## What changed, per file
- `routes/attendance.js`: three endpoints under `/attendance`
  (`POST`/`GET :id`/`GET` list), mirroring `routes/classes.js`'s shape
  — a local `ATTENDANCE_BODY_FIELDS` snake<->camel translation table,
  `requireResolvedTenant` guard, `mapAttendanceServiceError` covering
  all six of `attendanceService.js`'s error classes.
  - **The one real departure from every prior Module 3/4 route**:
    `POST /attendance` uses `requireAuth` only, not
    `requireRole('principal')`. Every other route's write endpoint
    uses that placeholder because its underlying service has no
    authorization logic of its own; `attendanceService.markAttendance`
    already enforces BusinessRules.md's real three-actor rule itself.
    Gating this route with `requireRole('principal')` on top would
    have locked out every actor the rule actually names — ordinary
    teaching staff and class tutors aren't principals — defeating the
    entire point of `576ca6b`'s work. `AttendanceForbiddenError` maps
    to 403 instead.
  - `POST /attendance` passes both `actorUserId: req.jwtClaims.sub`
    and `actorRole: req.jwtClaims.role` into `markAttendance` — the
    first route in this codebase that needs to thread the actor's
    role into a service call for a real per-request authorization
    decision, not just RBAC gating at the route.
  - Returns `200`, not `201`: `markAttendance` is a real
    mark-or-re-mark upsert with no signal in its return value for
    which branch fired, and changing that contract wasn't this
    slice's job.
  - No `DELETE` route: `attendance_sessions` is soft-delete only, and
    `attendanceService.js` exposes no wrapper over
    `attendanceRepository.softDelete` for a route to call — building
    one now would mean inventing both the wrapper and its
    (`WorkflowService`-gated) approval flow in the same breath.
  - `GET /attendance` requires both `class_id` and `session_date`
    (400 if either missing) — `listAttendanceSessionsForClassAndDate`
    takes both as required arguments, unlike
    `facultyAllocation.js`'s either/or list filter.
- `tenantApp.js`: `require('./routes/attendance')` +
  `app.use(createAttendanceRouter())`, same block as every other
  Module 3/4 router.

## Tests
Live integration tests (`attendance.test.js`) against the real,
already-running Docker Postgres — no unit-test layer added in this
slice, since `attendanceService.js` itself already has its own
extensive unit-test coverage (`576ca6b`) that this route slice adds no
new business logic to duplicate. Seeded one tenant with a principal, a
tutor, an HOD, a genuinely scheduled staff member (a real
`faculty_allocation` row linking them to an `'Approved'` class's
Saturday-Hour-3 period), an unrelated random staff member, one
`'Approved'` class and one `'Pending HOD'` class (both flipped/left via
direct SQL — the same bypass `attendanceService.js`'s own tests already
document as the only way to reach these states today):

- **All three authorized markers, proven through a real HTTP request**
  — PASS: the class tutor, an HOD force-marking a class they don't
  tutor, and — the actual point of this slice —
  the genuinely scheduled staff member (no tutor/HOD status at all)
  each successfully marked attendance via `POST /attendance`, 200,
  against real seeded data. This is the first time the
  `faculty_allocation` link built in Module 3's normalization slices
  (`4fa8f12`/`8b66a4c`/`e36bfb8`) and wired into authorization in
  `576ca6b` was exercised all the way from an HTTP request down to a
  real database row — not through a mock, not through direct service
  calls in a verification script, through the actual route.
- **Unrelated staff correctly rejected** — PASS: 403, not 500 or a
  silent success.
- **State-conflict mappings** — PASS: a `'Pending HOD'` class ->
  409 (`AttendanceTimetableNotApprovedError`); a session locked via
  direct `UPDATE` (still no real code path can do this) -> 409 on the
  next mark attempt (`AttendanceLockedError`).
- **Validation/not-found** — PASS: missing `class_id` -> 400;
  nonexistent `class_id` -> 404.
- **Re-mark updates in place** — PASS: same session id, updated
  `absent_student_ids`/`total_students`.
- **Reads** — PASS: get by id (200/404); list requiring both
  `class_id` and `session_date` (400 for either missing), returning
  the class's marked periods for that date.
- **RBAC** — PASS: both `POST` and `GET` require authentication
  (401 unauthenticated); critically, `POST` succeeded for an HOD and
  for an ordinary scheduled staff member — neither a principal —
  confirming the deliberate departure from the `requireRole('principal')`
  convention actually works as intended, not just compiles.
- **Cross-tenant isolation** — PASS: a session from tenant A returned
  404 under tenant B.
- **Audit attribution** — PASS: mark then re-mark on the same session
  produced exactly two `audit_log` rows, `'attendance_marked'` then
  `'attendance_remarked'`, both correctly attributed to the actor.

Ran the full backend suite (`npm test`): **285/285 pass** (268
pre-existing + 17 new), no regressions.

## A pre-existing scratch-data leak found and cleaned up (unrelated to this slice)
While verifying test cleanup, found one leftover college
(`attsvcvermr5s9zqc`, 3 users, 1 class) in the shared Docker Postgres
predating this session — traced by its `attsvcver` prefix to an
earlier session's `verify-attendance-service.js` scratch script
(`576ca6b`'s own work), which must not have reached its cleanup step
in whatever session created it. Not caused by this slice's own tests
(which use a different, non-colliding prefix pattern) — removed it
directly via the admin pool so the shared database stays clean for
whichever slice runs next.

## Flags / open questions
- **The "scheduled staff" authorization path is still data-starved in
  real deployments** — restated once more, now proven differently:
  this slice shows the *mechanism* works end-to-end when the data
  exists; nothing yet populates `timetable_periods`/
  `faculty_allocation` from any real workflow (no CSV-upload path —
  flagged since `4fa8f12`, still open). A real college using this
  system today would need a principal/HOD to call
  `POST /faculty-allocation`/`POST /timetable-periods` directly to
  ever unlock this leg in practice.
- **`markAttendance` is still gated on `timetable_status ===
  'Approved'`, unreachable via any real approval workflow** —
  unchanged, restated from every prior Attendance slice:
  `WorkflowService` (Module 8) doesn't exist.
- **No lock-setting mechanism, no soft-delete route** — both
  unchanged from `576ca6b`/`49c8b4b`'s own flags.
- **No UI** — matches this slice's own scope (API only); no frontend
  screen was searched for this specific slice since `attendance`
  already has real, working frontend consumers
  (`StaffDashboard.jsx`/`TutorClass.jsx`) documented extensively in
  prior Attendance slices — repointing them is separate, future work,
  not attempted here.
