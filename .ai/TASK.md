# TASK

## Objective
Module 4 (Attendance): patch `attendanceService.js`'s authorization
check (`assertCanMark`) to add the third eligible actor
BusinessRules.md's Attendance section names — "the staff member
scheduled for that period" — now that Module 3's `4fa8f12`/`8b66a4c`
built the real, structured link (`timetable_periods` +
`faculty_allocation`) that `82f8479` explicitly said didn't exist yet.

## Grounding (read before assuming any composition is safe)
- `attendanceService.js`'s own prior state (`82f8479`): `assertCanMark`
  verified only class tutor (`classes.tutor_user_id === actorUserId`)
  and HOD (`actorRole === 'hod'`), with a long comment explaining why
  the third actor couldn't be verified — resolving a free-text
  timetable cell to a real user_id would require the same fuzzy
  substring/normalize match `TutorClass.jsx` does client-side, which
  is too unreliable to sit behind a real authorization decision.
- `academicService.js`'s faculty-allocation additions (`8b66a4c`):
  `listFacultyAllocationsForStaff`/`getFacultyAllocation` already
  existed, but nothing wrapped the one lookup this patch actually
  needs — `facultyAllocationRepository.findByClassAndPeriod` (a class's
  allocation for one specific period) or
  `timetablePeriodRepository.findByCollegeDayAndHour` (resolving a
  day+hour to the shared period row) — neither had an `academicService`
  wrapper before this patch.
- `timetable_periods`/`faculty_allocation`'s own migration (`4fa8f12`):
  `timetable_periods` is keyed by `(college_id, day_of_week, hour_index)`
  — a **day-of-week name** (`'Monday'`, `'Saturday'`, ...), not a
  calendar date. `attendance_sessions.session_date` (and
  `markAttendance`'s own `sessionDate` parameter) is a **calendar
  date** (`'2026-07-04'`). Bridging these two is the one genuinely new
  piece of logic this patch adds — see the design decision below.

## Key design decision: converting sessionDate to a day-of-week name, safely
`assertCanMark` needs a `day_of_week` string to look up the shared
`timetable_periods` row, but only has a calendar date. `new
Date(sessionDate).getDay()` was deliberately NOT used: `getDay()`
reads the *local* calendar day in whatever timezone the Node process
happens to run in, and a date-only string like `'2026-07-04'` parses
to UTC midnight — on a server west of UTC, `getDay()` on that instant
can read back the *previous* day. Live-verified before writing any
service code (not guessed): `Date.UTC(year, month - 1, day)` +
`.getUTCDay()`, with the year/month/day pulled directly out of the
input string, confirmed `'2026-07-04'` -> `'Saturday'` regardless of
the running process's timezone. `dayOfWeekName()` in
`attendanceService.js` is that helper; it expects an ISO date string
(the same shape any real JSON request body sends), not a JS `Date`
object — a `Date` object round-tripped from a Postgres `DATE` column
carries its own, different timezone quirk (node-postgres constructs
`DATE` values at *local* midnight, not UTC), which this patch avoids
entirely by only ever converting the function's raw string input, not
anything read back from the database.

## Key design decision: two new academicService lookups, composed in attendanceService, not a new combined function
`academicService.getTimetablePeriod(client, collegeId, dayOfWeek,
hourIndex)` (wraps `timetablePeriodRepository.findByCollegeDayAndHour`)
and `academicService.getFacultyAllocationForClassAndPeriod(client,
classId, periodId)` (wraps `facultyAllocationRepository.findByClassAndPeriod`)
are both thin, generic reads — exactly the same shape as every other
`getX` in `academicService.js`. The two-step composition (date -> day
name -> period -> allocation -> staff match) lives entirely in
`attendanceService.assertCanMark`, not as a single bundled
"isScheduledStaff" function in `academicService.js`: `academicService`
owns the two structural lookups (Architecture.md 2.5 already assigns
it "faculty allocation" and "timetable"), but the *authorization*
decision — what to do with those lookups' results — is
`AttendanceService`'s own business rule, per Architecture.md's "reads
(does not own) timetable/approval state from AcademicService."
Matches how `assertTimetableApproved` already reads `cls.timetable_status`
from a plain `academicService.getClass` call rather than
`academicService` exposing a bespoke `isApproved()` function.

## Key design decision: real, live-verified code — still data-starved in practice, and that's stated plainly, not hidden
Both new lookups return `null` gracefully when nothing exists yet
(no period defined for that slot, or no allocation recorded), falling
through to the existing `AttendanceForbiddenError`. Since nothing in
this codebase populates `timetable_periods`/`faculty_allocation` yet
(no CSV-upload-to-normalized-rows path exists — flagged in `4fa8f12`'s
own `.ai/RESULT.md`, still unsolved), this third leg will almost
always resolve to "no match" against real production data today — the
same shape of gap `assertTimetableApproved`'s gate already has
(real, correct enforcement code, with no real data behind it yet, for
a different reason). This patch closes the *authorization-logic* gap
`82f8479` named; it does not and cannot make attendance marking
practically usable end-to-end by itself — that still needs both
`WorkflowService` (for `'Approved'` timetables) and a real
allocation-population path (for this leg to ever actually fire).
Restated, not solved, per this codebase's established discipline.

## Files likely affected
- `backend/src/services/attendanceService.js` (patched)
- `backend/src/services/academicService.js` (extended: two new
  read-only lookups)
- `backend/tests/attendance-service.test.js` (patched/extended)

## Exact changes

**`academicService.js`**: added
`const timetablePeriodRepository = require('../repositories/timetablePeriodRepository')`,
and two new exported functions —
`getTimetablePeriod(client, collegeId, dayOfWeek, hourIndex)` and
`getFacultyAllocationForClassAndPeriod(client, classId, periodId)` —
both thin passthroughs, `null` meaning not found, same convention as
every other `getX` in this file.

**`attendanceService.js`**:
- New `DAY_NAMES`/`dayOfWeekName(sessionDate)` helper.
- `assertCanMark` is now `async` and takes `(client, cls, sessionDate,
  hourIndex, actorUserId, actorRole)` (was a sync function taking just
  `(cls, actorUserId, actorRole)`). Tutor/HOD checks unchanged and
  still short-circuit before any new lookup runs (no added DB calls on
  the two already-working paths). If neither, it now composes
  `academicService.getTimetablePeriod` +
  `academicService.getFacultyAllocationForClassAndPeriod` to check
  whether `actorUserId` is genuinely allocated to teach this class
  during this exact period; only then does it throw
  `AttendanceForbiddenError`.
- `markAttendance`'s call site updated to `await assertCanMark(client,
  cls, sessionDate, hourIndex, actorUserId, actorRole)`.
- Updated the file-level and `AttendanceForbiddenError`/`assertCanMark`
  comments to reflect that all three BusinessRules.md actors are now
  attempted (previously documented as "two of three, deliberately").

**`attendance-service.test.js`**: the two existing "rejected, not
tutor, not HOD" tests updated to mock `academicService.getTimetablePeriod`
returning `null` (so they still exercise the same rejection path
without hitting an unmocked call). Three new tests: rejected when a
period exists but this class has no allocation for it; rejected when
an allocation exists but for a *different* staff member; and the
scheduled-staff success path, which also asserts the exact
`(collegeId, dayOfWeek, hourIndex)`/`(classId, periodId)` arguments
passed through the composition (`'2026-07-04'` -> `'Saturday'`).

## Acceptance criteria
- `assertCanMark`'s tutor/HOD paths are unchanged in behavior — no new
  DB calls on those two paths (verified via mock call counts staying
  at zero for the new lookups in the tutor/HOD unit tests).
- A genuinely scheduled staff member (real `faculty_allocation` row,
  `staff_user_id` matching the actor, correct class + period) can mark
  attendance, live, against a real database — not just a mocked unit
  test.
- An unrelated staff member with no allocation for that exact period
  is still rejected, live.
- A staff member allocated to a *different* hour on the same day/class
  does not gain access to an hour they're not allocated to, live.
- `dayOfWeekName` is proven correct against a concrete, known date
  (`'2026-07-04'` -> `'Saturday'`), both in a unit test and against the
  real seeded data live.
- Tutor and HOD access remain fully unaffected (regression check),
  live.
- Full backend suite passes with no regressions (221 tests: 218
  pre-existing + 3 net new).
