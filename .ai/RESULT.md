# RESULT

## Files changed
- `frontend/src/pages/StaffDashboard.jsx`

No backend files touched — this slice is UI-only, matching Module 3's
own UI-slice precedent (`dbe8380`).

## What changed
- Added `accessToken` to the `useAuth()` destructure (wasn't pulled in
  before — nothing in this file previously called a real, auth-checked
  endpoint).
- `handleMarkPeriodAttendance`'s fetch repointed: `/api/staff/mark-period-attendance`
  -> `/api/v1/attendance`, with a real `Authorization: Bearer ${accessToken}`
  header added. Body renamed: `tutor_id` -> `class_id`, `date_key` ->
  `session_date` (value extraction unchanged), `absent_rolls` ->
  `absent_student_ids`, plus `total_students` (already present under
  that exact name on `selectedPeriod`, no rename needed). Error
  handling switched `errData.error` -> `errData.detail`, matching
  every prior UI repoint slice's precedent.
- Nothing else in the file touched: `fetchSchedule`
  (`GET /api/staff/my-schedule`), `fetchWorkload`, `fetchHistory`, and
  the entire marksheet-submission form all remain on their old,
  still-dead prototype endpoints.

## Two blocked dependencies, named explicitly, not papered over
- `selectedPeriod.class_id` does not exist in `GET /api/staff/my-schedule`'s
  response shape (that endpoint doesn't exist in the Node backend
  either — confirmed via grep, same situation `/api/hod/classes` was
  in before Module 3's UI slice). The rename to `class_id` is correct
  for the real API, but the value it reads is currently always
  `undefined` — blocked on a future slice repointing that GET endpoint
  (or building a real "my schedule" equivalent).
- `absentRolls` holds `student.roll_number` strings, not real
  `students.id` UUIDs the real `absent_student_ids` column expects —
  same "prototype only ever had a human-facing identifier, the real
  column needs a resolved id" gap `attendanceService.js`'s own design
  decision already flagged for this exact column when the ERD was
  built. Also blocked on the same future schedule-repoint slice
  (`selectedPeriod.students` would need real ids, not just
  `roll_number`, to fix this for real).

Net effect, identical in shape to Module 3's own UI slice: this
repoint is correct given the real API, not yet reachable with real
data. Both gaps are two separate, explicitly named blockers, not one
vague one, and neither is invented or guessed at.

## TutorClass.jsx deliberately untouched
Named explicitly in `.ai/TASK.md` because the task's own framing
invites the comparison: `attendanceService.js`'s own grounding notes
(`82f8479`) already settled that `TutorClass.jsx`'s aggregate
`present_today`/`present_this_hour` counter is a dead end for
`attendance_sessions`'s real per-student shape — the individual
students it lets a tutor check off are computed into a count and
discarded, never transmitted anywhere. Nothing about closing
`StaffDashboard.jsx`'s gap changes that; not repointed, not
revisited.

## Verification
1. **`npm run build` (frontend)** — succeeds cleanly, no errors, all
   1510 modules transform.
2. **Live end-to-end API shape proof** — started the real backend
   against the already-running Docker Postgres, seeded a real tenant
   with a tutor user and one real `'Approved'` class, logged in
   through the real `POST /api/v1/auth/login`, then called
   `POST /api/v1/attendance` with the **exact** body and headers
   `handleMarkPeriodAttendance` now sends
   (`{ class_id, session_date, hour_index, absent_student_ids,
   total_students }` + `Authorization: Bearer <token>`). Confirmed a
   real `200` with the created `attendance_sessions` row
   (`marked_by_user_id` correctly the tutor, `class_id`/`hour_index`/
   `total_students` all round-tripped correctly).
3. **Failure-path proof** — the identical call with `class_id`
   omitted returned a real `400` with `{"detail": "classId,
   sessionDate, hourIndex, and totalStudents are required"}` —
   confirms the `errData.detail` rename (not `errData.error`) is
   correct, not just plausible. The identical call with no
   `Authorization` header returned a real `401`
   (`{"detail": "Authentication required"}`) — confirms the newly
   added header is actually load-bearing, not a no-op.
4. Cleaned up all seeded verification data afterward; stopped the
   backend process.

**Honest gap, same as every prior UI-repoint slice**: no browser
click-through was performed (no browser automation available in this
sandbox, consistent with every prior UI slice's own documented
limitation) — the panel's visual rendering was not observed directly.
Confidence here comes from the exact-shape live API proof above (the
JSX consuming the response does only a `showToast` + `fetchSchedule()`
on success, no complex parsing of the response body that could throw
on the real shape) plus the fact that this panel cannot currently
render with real data at all (its own data source is unrepointed),
making a visual regression on the *currently observable* app
impossible by construction.

## Flags / open questions
- **`GET /api/staff/my-schedule` remains unrepointed** — the natural
  next step to make this whole panel reachable with real data at all;
  not attempted here per this task's own precise scope (only the POST
  flow named). Needs a real "my schedule" read path — no service
  function for "sessions/periods for the currently authenticated
  staff member" exists yet; `academicService.listFacultyAllocationsForStaff`
  is the closest real building block, unconsumed by any route or UI
  so far.
- **`absent_student_ids` still carries roll numbers, not real ids,
  once/if this panel ever becomes reachable** — same blocker, would
  need the schedule endpoint's student roster to carry real
  `students.id` too.
- **`TutorClass.jsx`'s aggregate attendance widget remains
  unrepointed and undecided** — deliberately out of scope, per the
  grounding already established in `82f8479`.
- **No backend files touched** — matches this slice's own UI-only
  scope.
