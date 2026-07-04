# RESULT

## Files changed
- `backend/src/services/attendanceService.js` (patched)
- `backend/src/services/academicService.js` (extended)
- `backend/tests/attendance-service.test.js` (patched/extended)

## What changed, per file
- `academicService.js`: added `timetablePeriodRepository` as a
  dependency alongside `classRepository`/`facultyAllocationRepository`,
  and two new thin, read-only functions: `getTimetablePeriod(client,
  collegeId, dayOfWeek, hourIndex)` (wraps
  `timetablePeriodRepository.findByCollegeDayAndHour`) and
  `getFacultyAllocationForClassAndPeriod(client, classId, periodId)`
  (wraps `facultyAllocationRepository.findByClassAndPeriod`). Both
  return `null` when nothing exists, same convention as `getClass`/
  `getFacultyAllocation`. The file-level comment was updated to
  explain these exist specifically for `attendanceService.assertCanMark`'s
  composition, not for any consumer of their own yet.
- `attendanceService.js`: `assertCanMark` — previously verified only
  the class tutor and HOD, with a long comment explaining why the
  third BusinessRules.md-named actor ("the staff member scheduled for
  that period") couldn't be verified — now verifies all three. It's
  `async` now, takes `(client, cls, sessionDate, hourIndex, actorUserId,
  actorRole)`, and when the actor is neither tutor nor HOD, converts
  `sessionDate` to a day-of-week name (new `dayOfWeekName` helper),
  looks up the shared `timetable_periods` row for
  `(cls.college_id, dayOfWeek, hourIndex)` via
  `academicService.getTimetablePeriod`, then looks up that
  `(cls.id, period.id)`'s `faculty_allocation` row via
  `academicService.getFacultyAllocationForClassAndPeriod` — if one
  exists and its `staff_user_id` matches `actorUserId`, access is
  granted. `markAttendance`'s call site now `await`s it. Comments
  throughout (file header, `AttendanceForbiddenError`, `assertCanMark`)
  updated to say all three actors are attempted, not two of three.
- `attendance-service.test.js`: the two existing "rejected — not
  tutor, not HOD" tests now mock `academicService.getTimetablePeriod`
  returning `null` (needed since `assertCanMark` calls it whenever
  neither short-circuit applies). Three new tests added: rejected when
  a period exists but no allocation for this class; rejected when an
  allocation exists but for a different staff member; and the
  scheduled-staff success path (which also asserts the exact
  `(collegeId, dayOfWeek, hourIndex)` and `(classId, periodId)`
  arguments flow through correctly, including the date-to-day-name
  conversion).

## A real timezone bug avoided by checking before writing any code
Before writing `dayOfWeekName`, checked empirically whether
`new Date(sessionDate).getDay()` was safe to use for a date-only ISO
string. It is not, in general: `'YYYY-MM-DD'` parses to UTC midnight,
but `.getDay()` reads the *local* calendar day of whatever timezone
the Node process is running in — on a server west of UTC, that can
read back the day *before* the intended one. Verified the fix instead:
`Date.UTC(year, month - 1, day)` (components parsed directly out of
the input string) + `.getUTCDay()` is immune to the running process's
timezone. Confirmed concretely: `'2026-07-04'` -> `'Saturday'`,
independent of local timezone. This is the same kind of "verify the
pg/JS interaction empirically before trusting it" discipline that
caught the `absentStudentIds` JSON-serialization bug in `82f8479` —
worth continuing, not a one-off.

## Tests
Two layers, same discipline as every prior slice touching this file.

**Unit tests** (extended `attendance-service.test.js`, no DB): 20
subtests total (17 existing, 2 updated to add the new mock, 3 new),
all passing — the two "still correctly rejected" paths (no period
found; period found but no allocation), the "allocated to someone
else" rejection, and the scheduled-staff success path with exact
argument assertions (`'2026-07-04'` -> `'Saturday'`, correct
`classId`/`periodId` threading).

**Live verification** against the real, already-running Docker
Postgres (`arcnave-blueprint-db-1` — up throughout this session, no
restart needed this time). Seeded a real tenant with a tutor, a
genuinely scheduled staff member, an unrelated random staff member, an
`'Approved'` class, one real `timetable_periods` row (Saturday, Hour
3), and one real `faculty_allocation` row linking that class+period to
the scheduled staff member:

- **The real gap, closed** — PASS: the genuinely scheduled staff
  member (not the tutor, not an HOD) successfully marked attendance —
  the exact capability `82f8479` documented as missing, now working
  end-to-end against real data, not a mock.
- **Still correctly rejected** — PASS: an unrelated staff member with
  no `faculty_allocation` row for that period was rejected with
  `AttendanceForbiddenError` — the gap is closed for the *right*
  person, not thrown open for anyone.
- **Scoped correctly to the exact period** — PASS: the same scheduled
  staff member was rejected for a *different* hour on the same
  class/day (no `timetable_periods` row existed for that hour in the
  test) — proves the check doesn't grant blanket access once any one
  allocation matches, and that the "no period found" path degrades to
  a clean rejection rather than an error.
- **No regression** — PASS: tutor access on the same class continued
  to work exactly as before, unaffected by the new third check.
- All seeded data cleaned up afterward.

Ran the full backend suite (`npm test`): **221/221 pass** (218
pre-existing + 3 net new subtests), no regressions.

## Flags / open questions
- **Still practically data-starved** — restated deliberately, not
  hidden: nothing in this codebase populates `timetable_periods`/
  `faculty_allocation` from any real workflow yet (no CSV-upload path
  — `4fa8f12`'s own flag, still open), so in real production usage
  today this third leg will almost always resolve to "no match,"
  identical in shape to `assertTimetableApproved`'s own
  `WorkflowService`-shaped gap. This patch closes the
  *authorization-logic* gap `82f8479` named; it doesn't make
  attendance marking practically usable end-to-end by itself.
- **No API route, UI, or `docs/modules/` file touched in this patch**
  — this is a business-logic fix to two existing service files, not a
  new vertical slice of its own.
- Everything else `82f8479`'s and `8b66a4c`'s own flags already
  named (no `lockAttendanceSession`, no CSV-upload population path, no
  update function on faculty allocation) remains exactly as open as
  before — unaffected by this patch.
