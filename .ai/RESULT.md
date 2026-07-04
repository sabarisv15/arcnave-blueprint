# RESULT

## Files changed
- `backend/src/services/attendanceService.js` (new)
- `backend/tests/attendance-service.test.js` (new)

## What changed, per file
- `attendanceService.js`: business logic over `attendanceRepository.js`
  — six error classes (`AttendanceValidationError`,
  `AttendanceClassNotFoundError`, `AttendanceTimetableNotApprovedError`,
  `AttendanceForbiddenError`, `AttendanceLockedError`,
  `AttendanceSessionConflictError`), and
  `markAttendance`/`getAttendanceSession`/
  `listAttendanceSessionsForClassAndDate`. `markAttendance` calls
  `academicService.getClass(...)` to read `classes.timetable_status`
  and `tutor_user_id` — the first cross-domain service composition in
  this codebase, matching Architecture.md 2.5's explicit statement
  that AttendanceService reads timetable/approval state from
  AcademicService, not from AcademicRepository directly.
  - `assertTimetableApproved` enforces CLAUDE.md rule 7 checking
    `classes.timetable_status` exactly as stored. Since nothing can
    set that column to `'Approved'` via any real API yet
    (`WorkflowService`, Module 8, doesn't exist — flagged again here,
    per this session's explicit instruction, not solved), this makes
    `markAttendance` end-to-end unreachable for any real class today.
    Intentional, not a bug — see `.ai/TASK.md`.
  - `assertCanMark` enforces two of BusinessRules.md's three named
    eligible actors (class tutor via `tutor_user_id` equality; HOD via
    `actorRole === 'hod'`) and deliberately does **not** attempt the
    third ("the staff member scheduled for that period"): doing so
    would require resolving `classes.timetable_data`'s free-text grid
    cells to a real user identity, which nothing in this schema makes
    reliable (Module 3 explicitly deferred any normalized
    faculty-allocation structure). This under-enforces on the safe
    side — a stricter subset of BusinessRules.md's actual allowance,
    never a looser one — at the real cost of ordinary scheduled staff
    (StaffDashboard.jsx's actual primary user) not yet being able to
    mark their own periods through this service. Full reasoning in
    `.ai/TASK.md`.
  - `markAttendance` finds-then-creates-or-updates
    (`attendanceRepository.findByClassSessionAndHour`, then `create`
    or `update`), rejecting an update against an already-locked
    session (`AttendanceLockedError`), and mapping the rare
    `attendance_sessions_class_date_hour_key` unique-index race on
    `create` to `AttendanceSessionConflictError`.
  - `absentStudentIds` is `JSON.stringify`'d in this file before being
    handed to `attendanceRepository` — see the grounding note below,
    this was a real bug caught during this slice's own build, not a
    defensive guess.

## A real bug caught while building this slice
Discovered live, against the actual database, before it ever reached
a test: passing a raw JS array (e.g. `['s1', 's2']`) as a query
parameter bound to `attendance_sessions.absent_student_ids` (jsonb)
fails with a genuine Postgres error:

```
SELECT $1::jsonb AS val   -- param: ['a','b','c']
-> 22P02 invalid input syntax for type json
```

node-postgres serializes a raw array parameter using Postgres's native
`{a,b,c}` ARRAY-literal text format, not JSON array syntax — and `{a,b,c}`
is not valid JSON, so the jsonb cast fails outright. `JSON.stringify(['a','b','c'])`
(`'["a","b","c"]'`) works correctly. `classRepository.js`'s own
`timetable_data` JSONB column never hit this because its value is
always a plain object, which pg *does* auto-serialize as JSON — the
same trap simply couldn't manifest there. Fixed by stringifying inside
`attendanceService.markAttendance`, at the same layer
`auditLogRepository.createAuditLogEntry` already stringifies its own
`metadata` column, not inside `attendanceRepository.js` (which stays a
plain, format-agnostic pass-through, consistent with every other
repository in this codebase).

## Tests
Two layers, matching the discipline established since Module 3's
second slice:

**Unit tests** (`attendance-service.test.js`, no DB — `node:test`'s
`t.mock.method` stubs `attendanceRepository`/`academicService`/
`auditLogRepository`): 17 subtests, all passing — missing-field/actor
validation (3), class-not-found (1), timetable-not-approved (1),
forbidden-actor including the no-tutor-assigned case (2), tutor
create-path success with correct `JSON.stringify`d payload and audit
attribution (1), HOD force-mark success (1), default
`absentStudentIds` to `'[]'` (1), re-mark-updates-in-place (1),
locked-session rejection (1), unique-index race mapped to
`AttendanceSessionConflictError` (1), non-conflict error passthrough
(1), and the two thin-passthrough reads (2).

**Live verification** against the real, already-running Docker
Postgres (`arcnave-blueprint-db-1` — had stopped since the last
session, restarted cleanly with all prior data intact on its
persistent volume). Seeded a real tenant with a tutor user, an HOD
user, an unrelated "random staff" user, one class stuck at
`'Pending HOD'`, and one class at `'Approved'` (set via a direct
`UPDATE` — the exact bypass no real service call may ever perform,
used here only to reach the branch under test):

- **Rule 7 gate** — PASS: marking against the `'Pending HOD'` class
  raised `AttendanceTimetableNotApprovedError`, no bypass involved.
- **Authorization** — PASS: the unrelated "random staff" actor
  (neither tutor nor HOD) was rejected on the `'Approved'` class with
  `AttendanceForbiddenError` — a live, concrete instance of the
  flagged "scheduled staff" gap: this actor could legitimately be the
  scheduled staff member for that period, and the service still
  correctly cannot verify that, so it correctly refuses rather than
  guessing.
- **Tutor marks a real session** — PASS: the created row's
  `absent_student_ids` round-tripped as `['1111...']` exactly (proving
  the `JSON.stringify` fix genuinely works end-to-end against
  Postgres, not just that it avoids an error in a mocked unit test),
  `marked_by_user_id` correctly set to the tutor.
- **HOD force-marks (re-marks) the same period** — PASS: same row id
  (an update, not a new row), `absent_student_ids` and
  `marked_by_user_id` both updated to reflect the HOD's action.
- **`audit_log`** — PASS: exactly two rows for that session id — the
  tutor's `'attendance_marked'` then the HOD's `'attendance_remarked'`
  — each attributed to the correct actor.
- **Lock enforcement** — PASS: after setting `locked_at` via a raw
  `UPDATE` (again, the only way to reach this state today), the class
  tutor's own attempt to modify the same session was rejected with
  `AttendanceLockedError`.
- **Read helpers** — PASS: `getAttendanceSession`/
  `listAttendanceSessionsForClassAndDate` both returned correct data
  against the live rows.
- **Nonexistent `classId`** — PASS: `AttendanceClassNotFoundError`.
- All seeded data cleaned up afterward.

Ran the full backend suite (`npm test`): **203/203 pass** (186
pre-existing + 17 new), no regressions.

## Flags / open questions
- **`markAttendance` is end-to-end unreachable for any real class
  today** — restated, not solved: `classes.timetable_status` cannot
  reach `'Approved'` via any real API without `WorkflowService`
  (Module 8). This is expected given Roadmap.md's locked dependency
  order, not a defect in this slice.
- **"Scheduled staff member" authorization is not verified** —
  ordinary teaching staff cannot mark their own periods through this
  service as built; only the class tutor or an HOD can. Closing this
  needs a real, structured faculty-allocation link (which class,
  which hour, which staff user_id) that doesn't exist yet — explicitly
  not guessed at via free-text matching here. See `.ai/TASK.md`.
- **No `lockAttendanceSession` function** — the `locked_at` check is
  real and live-verified, but nothing in this codebase can set it yet.
  BusinessRules.md doesn't specify who locks a session or when;
  Architecture.md's "attendance windows, lock" phrasing suggests an
  automatic, window-based mechanism rather than a manual role-gated
  action — building one now would be guessing at an unspecified
  mechanism, deferred to a later slice.
- **No API route, UI, or `docs/modules/` file touched in this slice**
  — matches Module 3's second slice's own scope exactly.
