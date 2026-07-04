# TASK

## Objective
Module 4 (Attendance), second vertical slice: `AttendanceService` —
business logic over `attendanceRepository.js`, same pattern as
`academicService.js` (Module 3's second slice, `70b6e68`). Enforces
the real business rules from BusinessRules.md's Attendance section
that can actually be enforced with structured data today; explicitly
does not fake enforcement of the ones that can't yet. No API/UI yet.

## Grounding (read before assuming any function list)
- `.ai/RESULT.md` (first slice) for `attendanceRepository.js`'s exact
  shape/columns — this slice wires to those verbatim.
- `academicService.js` (the named pattern): error-class-per-rule
  style, domain errors instead of raw pg errors, audit-log entries,
  thin passthroughs for simple reads.
- `docs/architecture/Architecture.md` 2.5: "AttendanceService ...
  reads (does not own) timetable/approval state from
  AcademicService" — stated explicitly, not inferred. This slice's
  `markAttendance` calls `academicService.getClass(...)`, never
  `classRepository` directly — the first cross-domain service
  composition in this codebase (every prior service only ever called
  its own single repository).
- `docs/architecture/BusinessRules.md` Attendance section: "Attendance
  is marked hour-wise, within a defined attendance window," "Attendance
  cannot be modified after it is locked," "Only the staff member
  scheduled for that period, the class tutor, or an HOD (force-mark)
  may mark attendance for a given hour."

## Known open gap, restated per this session's explicit instruction, not solved
Module 3's fourth slice (`dbe8380`) and Module 4's first slice
(`49c8b4b`) both already flagged: nothing can set
`classes.timetable_status` to `'Approved'` through any real API yet —
`WorkflowService` (Module 8) doesn't exist. This slice's decision,
stated plainly: **`assertTimetableApproved` checks
`classes.timetable_status` exactly as it is stored, with no bypass, no
"any non-Rejected status counts," no dev/test shortcut.** The direct,
intended consequence is that `markAttendance` is end-to-end
unreachable for any real class today — every class in this system
currently has a `timetable_status` other than `'Approved'`, because
nothing can legitimately set it. This is correct behavior for building
services in Roadmap.md's locked dependency order (Academic before
Attendance), not a bug to route around. Proving the `'Approved'`
branch of this slice's own logic even works at all required setting
`timetable_status` via a raw `UPDATE` run directly against Postgres in
this slice's live verification (see `.ai/RESULT.md`) — precisely the
kind of bypass no real service call will ever be allowed to perform.

## Key design decision: only two of BusinessRules.md's three eligible actors are verified
"Only the staff member scheduled for that period, the class tutor, or
an HOD (force-mark) may mark attendance for a given hour":
- **Class tutor** — verified with real, structured data:
  `classes.tutor_user_id === actorUserId` (Module 3).
- **HOD (force-mark)** — verified with real, structured data:
  `actorRole === 'hod'`, trusted the same way `rbac.js` trusts
  `req.jwtClaims.role` (an already-verified JWT claim).
- **"The staff member scheduled for that period"** — **deliberately
  not verified in this slice.** Verifying it would require resolving
  `classes.timetable_data`'s free-text grid cell (e.g.
  `"DBMS (Dr. Amit)"`) to a real `user_id`. Nothing in this schema
  makes that resolution reliable: Module 3's first slice explicitly
  deferred building any `subjects`/`faculty_allocation`/
  `timetable_periods` structure. The only available technique would be
  the same fuzzy normalize-and-substring match `TutorClass.jsx`
  already does client-side purely for a read-only display
  (`normUser === normStaff || normStaff.includes(normUser) ||
  normUser.includes(normStaff)`). Putting a heuristic text match
  behind a real authorization decision is a materially different,
  riskier thing than using it for a display hint — BusinessRules.md's
  own "final year" note already warns that this kind of soft text
  match "is not a guaranteed structured filter... until a dedicated
  field is added." Until a real, structured faculty-allocation link
  exists, this leg is **under-enforced on purpose**: only the tutor or
  an HOD can mark today — a *stricter* subset of who BusinessRules.md
  actually permits, never a looser one, so nothing unauthorized is
  newly allowed by this omission. The real, practical cost: ordinary
  scheduled teaching staff — `StaffDashboard.jsx`'s primary real
  user, the person the whole `mark-period-attendance` flow was
  actually built around — **cannot mark their own periods through this
  service as built**. This is a genuine, named functionality gap, not
  a silently accepted one; closing it needs a real structured
  faculty-allocation link, which is new API/data surface, not
  something to guess at here.

## Key design decision: no lockAttendanceSession function added
BusinessRules.md states the *effect* of being locked ("cannot be
modified") but not who locks a session or when. Architecture.md groups
"attendance windows, lock" together, suggesting an automatic,
window-based mechanism rather than a manual action mirroring the
mark-authorization rule's named actors. Building a manual lock action
now would be guessing at an unspecified mechanism — the same
"don't invent structure nobody asked for yet" call Module 3 made
repeatedly. `markAttendance`'s `locked_at IS NOT NULL` check is real
code, but currently has no way to become true through this slice
either — the same shape of gap as the `'Approved'` gate above, for a
different underlying reason (no lock-setting logic exists yet, vs. no
approval workflow exists yet). Verified live the same way: setting
`locked_at` via a raw `UPDATE` run directly against Postgres, then
confirming the service refuses to modify that session even for its own
class tutor.

## Key design decision: absentStudentIds must be JSON.stringify'd by the service, not the repository
Live-verified while building this slice: node-postgres serializes a
raw JS array query parameter using Postgres's native ARRAY-literal
syntax (`{a,b}`), not JSON syntax. Passed straight through to a
`jsonb` column, this fails with a real `22P02 invalid input syntax for
type json` — reproduced directly against the live database (see
`.ai/RESULT.md`). `classRepository.js`'s `timetable_data` never hit
this because that JSONB value is always a plain object (pg
auto-serializes objects as JSON correctly); `attendance_sessions`'s
`absent_student_ids` is an array, which needs an explicit
`JSON.stringify()` at the call site — `auditLogRepository.
createAuditLogEntry` already established exactly this "stringify at
the call site, not inside the generic repository" pattern for its own
`metadata` column. `attendanceService.markAttendance` is that call
site here; `attendanceRepository.js` itself is unchanged, still just a
pass-through.

## Files likely affected
- `backend/src/services/attendanceService.js` (new)
- `backend/tests/attendance-service.test.js` (new)

## Exact changes

**`attendanceService.js`**:
- Error classes: `AttendanceValidationError` (missing required fields
  or actor identity), `AttendanceClassNotFoundError` (bad `classId`),
  `AttendanceTimetableNotApprovedError` (rule 7 gate),
  `AttendanceForbiddenError` (not tutor, not HOD),
  `AttendanceLockedError` (existing session's `locked_at` is set),
  `AttendanceSessionConflictError` (rare race on the partial unique
  index, mapped from Postgres 23505 as defense in depth).
- `markAttendance(client, { classId, sessionDate, hourIndex,
  absentStudentIds, totalStudents }, { actorUserId, actorRole })` —
  validates required fields including actor identity; fetches the
  class via `academicService.getClass`; runs
  `assertTimetableApproved` then `assertCanMark`; looks up an existing
  session via `attendanceRepository.findByClassSessionAndHour`; if
  found and unlocked, updates it (re-mark); if found and locked,
  throws; if not found, creates it (mapping the rare unique-index race
  to `AttendanceSessionConflictError`); writes an audit_log entry
  (`'attendance_marked'` on create, `'attendance_remarked'` on
  update) attributed to `actorUserId`.
- `getAttendanceSession(client, id)` — thin passthrough, `null` means
  not found.
- `listAttendanceSessionsForClassAndDate(client, classId,
  sessionDate)` — thin passthrough to `findByClassAndDate`, wrapped
  (unlike `academicService.js`'s own unwrapped secondary lookups)
  because a concrete future consumer — `StaffDashboard.jsx`'s
  "today's schedule" screen — is already known, not speculative.

## Acceptance criteria
- `markAttendance` rejects missing required fields and missing actor
  identity without touching the DB.
- `markAttendance` rejects a class whose `timetable_status` isn't
  `'Approved'`, checked exactly as stored — no bypass.
- `markAttendance` rejects any actor who is neither the class's tutor
  nor role `'hod'` — proven live against a real "ordinary scheduled
  staff, not tutor, not HOD" actor being correctly rejected (the
  flagged gap made concrete, not just described).
- `markAttendance` allows the class tutor and an HOD (even one who
  doesn't tutor the class) to mark, live, against a real `'Approved'`
  class.
- Re-marking an existing, unlocked session updates it in place
  (same id), not a duplicate row; re-marking a locked session is
  rejected, live, using a session locked via direct SQL (since no real
  code path can lock one yet).
- `absentStudentIds` round-trips correctly end-to-end through the real
  jsonb column, live — proving the `JSON.stringify` fix actually works
  against Postgres, not just that it doesn't throw in a unit test.
- Audit log entries are correctly attributed to the actual actor
  (tutor on create, HOD on a force-mark re-mark), proven live.
- A non-conflict repository error passes through unchanged.
- No API route, UI, or lock-setting mechanism in this slice.
- Full backend suite passes with no regressions (203 tests: 186
  pre-existing + 17 new unit tests here).
