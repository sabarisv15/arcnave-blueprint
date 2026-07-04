# TASK

## Objective
Module 4 (Attendance), UI slice: repoint `StaffDashboard.jsx`'s real
`POST /api/staff/mark-period-attendance` flow — the actual grounding
source `attendance_sessions`'s ERD was built against
(`attendanceService.js`'s own `.ai/TASK.md` history, `82f8479`) — to
the real `POST /api/v1/attendance` (`7e466ec`). Same "repoint what's
real, flag what's blocked" discipline as Module 3's UI slice
(`dbe8380`).

## Grounding (read before assuming any rename is safe)
- `StaffDashboard.jsx`'s `handleMarkPeriodAttendance`: the only real,
  working per-student attendance-marking flow in this codebase — it
  sends `{ tutor_id, hour_index, absent_rolls, date_key }` to the
  (nonexistent in the Node backend, confirmed via grep, same as every
  other `/api/staff/*`/`/api/hod/*` prototype route) old endpoint.
  `TutorClass.jsx`'s "Live Attendance" widget (`present_today`/
  `present_this_hour`) is explicitly **not** touched here — it's not
  the grounding source (already settled in `attendanceService.js`'s
  own `.ai/TASK.md`: that widget "never names individual students at
  all... a materially weaker, dead-end shape"), and doesn't become one
  now.
- `routes/attendance.js`'s exact body shape (`7e466ec`): `class_id`,
  `session_date`, `hour_index`, `absent_student_ids`, `total_students`,
  requiring a real `Authorization: Bearer` header (`requireAuth`), and
  `err.detail` (not `err.error`) on failure.
- `fetchSchedule`'s own source, `GET /api/staff/my-schedule`: also
  confirmed via grep to not exist anywhere in the Node backend — same
  situation `classesList`'s old `GET /api/hod/classes` was in before
  Module 3's own UI slice. This means `schedule` state is always `[]`
  in the real app today, so the entire "Mark Attendance" button and
  its panel are already unreachable dead code — repointing the POST
  call underneath it carries zero behavior risk right now.

## Key design decision: two field-shape renames, both grounded, both still blocked upstream
- `tutor_id` (a username string, the old model's way of identifying
  "which class") -> `class_id` (the real backend's actual class
  identity) — the identical rename Module 3's own UI slice already
  made for `classesList`'s `tutor_id` -> `tutor_user_id`. Sourced from
  `selectedPeriod.class_id`, a field that does **not** exist in
  `GET /api/staff/my-schedule`'s still-unrepointed response shape
  (which only ever returns `tutor_id`) — this is not fixed here,
  flagged as blocked on a future slice repointing that GET endpoint
  (or building a real "my schedule" equivalent, e.g. over
  `academicService.listFacultyAllocationsForStaff`).
- `absent_rolls` (roll-number strings) -> `absent_student_ids` (real
  `students.id` UUIDs, per `attendance_sessions`'s own ERD) — same
  "the real column expects a resolved id, the prototype only ever had
  a human-facing identifier" gap `attendanceService.js`'s own design
  decision already named for this exact column. Also not fixed here:
  `selectedPeriod.students` (from the same unrepointed schedule
  endpoint) only ever carries `roll_number`, never a real student id.
- `selectedPeriod.total_students` needed **no** rename or new source —
  it already exists on the current (still-prototype) schedule shape,
  and the real API needs exactly that field, under exactly that name.
  Not every field in this repoint is blocked; this one already lines
  up.
- `session_date` (`selectedPeriod.periodKey.split('_')[0]`, was
  `date_key`) — a pure key rename, no shape change, same extraction
  logic kept as-is.

Net effect: this repoint is *correct given the real API*, but not yet
*reachable with real data* — identical in shape to Module 3's own UI
slice, where `classesList`'s rename was correct but `staffList`
stayed empty for a different unrepointed reason. Two separate blocked
dependencies are named here, not one, and neither is invented or
guessed at to paper over the gap.

## Key design decision: TutorClass.jsx is deliberately untouched
Named explicitly because the task's own framing invites the
comparison: `attendanceService.js`'s grounding notes already settled
that `TutorClass.jsx`'s aggregate `present_today`/`present_this_hour`
counter is a dead end for this column's real shape — it never sends
per-student identity anywhere, and the individual students a tutor
checks off there are computed into a count and discarded, never
transmitted. Nothing about closing `StaffDashboard.jsx`'s gap changes
that. Not repointed, not revisited.

## Files likely affected
- `frontend/src/pages/StaffDashboard.jsx`

## Exact changes
- `useAuth()` destructure gains `accessToken` (wasn't pulled in
  before — no fetch call in this file sent an `Authorization` header
  previously, since nothing it called was ever a real, checked
  endpoint).
- `handleMarkPeriodAttendance`'s fetch: URL `/api/staff/mark-period-attendance`
  -> `/api/v1/attendance`; adds `Authorization: Bearer ${accessToken}`;
  body renamed per the design decision above
  (`class_id`/`session_date`/`hour_index`/`absent_student_ids`/
  `total_students`); error handling `errData.error` ->
  `errData.detail`, matching every other UI repoint slice's own
  precedent (`dbe8380`/`49c2c36`/`c9b6248`).
- Nothing else in this file changed: `fetchSchedule`/`fetchWorkload`/
  `fetchHistory`/the marksheet-submission form/`handleFileUpload` all
  remain on their old, still-dead prototype endpoints — out of scope,
  per this task's own precise framing (only the POST flow named).

## Acceptance criteria
- `npm run build` (frontend) succeeds with no errors.
- Live, end-to-end proof the new request shape is accepted: seeded a
  real tenant + tutor user + real `'Approved'` class in the live
  Docker Postgres, logged in through the real
  `POST /api/v1/auth/login`, then called `POST /api/v1/attendance`
  with the *exact* body/headers `handleMarkPeriodAttendance` now sends
  — confirms a real `200` with the created `attendance_sessions` row.
- Confirmed the failure path too: the same call without an
  `Authorization` header gets a real `401`; a call missing `class_id`
  gets a real `400` with a `detail` field (not `error`) — proving the
  `errData.detail` rename is correct, not just plausible.
- No behavior change to any currently-observable app state:
  `schedule` was already always `[]` before this change (the source
  GET endpoint doesn't exist), so this panel was already fully
  unreachable and stays that way — this repoint changes what *would*
  happen if reached, not what currently renders.
- `TutorClass.jsx` untouched.
- No backend files touched — this slice is UI-only, matching Module
  3's own UI-slice precedent.
