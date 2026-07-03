# TASK

## Objective
Module 3 (Academic), fourth vertical slice: repoint the real, working
frontend's class/timetable *reads* to the real API
(`GET /api/v1/classes`, added in `235aa8b`). Same discipline as Module
2's fourth slice (`49c2c36`, staff edit-only repoint) and Module 1's UI
slice (`c9b6248`): ground against what's actually rendered today,
repoint only what the current API surface genuinely supports, and
flag — not silently skip — everything still blocked on missing
pieces.

## Grounding (read before assuming any repoint is safe)
- `.ai/RESULT.md` (third slice) for `routes/classes.js`'s exact
  response shape: `GET /api/v1/classes` returns a **bare array**
  (`res.json(classes)`, not `{ classes: [...] }`), each row carrying
  `tutor_user_id` (a real `users.id` UUID, nullable) — not the
  prototype's `tutor_id` (a username string). This mismatch is the
  crux of this slice; see the design decision below.
- `frontend/src/pages/HodDashboard.jsx` — `classesList` (was
  `GET /api/hod/classes`, confirmed via grep to not exist anywhere in
  the Node backend, so this call always 404'd and `classesList` stayed
  `[]`). Consumed in exactly five places: the "Class Tutor
  Assignments" panel display, the staff-directory's per-staff matched-
  class badge, `openEditStaff`'s linked-semester lookup, the
  `selectedTimetableTutor`/`selectedDashboardTutor` default-selection
  effect, and a plain length count.
- `frontend/src/pages/PrincipalDashboard.jsx` — an identical
  `classesList`/`GET /api/hod/classes` pair, consumed in the "Class
  Tutor Assignments" (Assign Tutor) panel and `handleLinkTutor`'s
  `targetCls` lookup.
- `frontend/src/pages/TutorClass.jsx` — a `deptClasses` state, HOD-only,
  also from `GET /api/hod/classes`, feeding the "Department Classes"
  `<optgroup>` in the class-switcher dropdown.
- `frontend/src/pages/TutorClassMonitor.jsx` — fetches
  `/api/monitor/tutor-classes`, a **composite** endpoint (class +
  full student roster + `present_today`/`present_this_hour`
  attendance figures joined together) that has no real-API analogue
  at all: no student-roster-per-class join exists in
  `academicService`/`classRepository`, and the attendance figures
  belong to Module 5 (Attendance), not built yet. Confirmed via grep:
  `/api/monitor/tutor-classes` does not exist in the Node backend
  either — this file's fetch already 404s today, exactly like
  `classesList` did.
- `docs/architecture/BusinessRules.md` Academic/Timetable and Staff
  sections, `CLAUDE.md` rule 3 (`WorkflowService` is the sole approval
  gate) and rule 7 (Academic before Attendance).

## Key design decision: tutor_id (username) -> tutor_user_id (UUID) breaks the existing username-matching, and that's left as-is, not patched over
The prototype UI's entire "which staff member tutors this class" model
is a client-side string match: `staffList.find(s => s.username ===
cls.tutor_id)`, everywhere it appears. `staffList` itself comes from
`GET /api/hod/staff` — also nonexistent in the Node backend (confirmed
via grep, same as `classesList`'s old endpoint), so `staffList` stays
`[]` regardless of this slice. Repointing `classesList` to the real
`tutor_user_id` (a UUID) does not make this match start working — it
already didn't work (404 kept `staffList` empty), and it still doesn't
after this slice (empty `staffList` still matches nothing, now for a
type-mismatch reason as well as an empty-list reason). This is
deliberately **not** fixed by also repointing `staffList`'s `GET` to
the real `GET /api/v1/staff`: doing so would be new scope this slice
wasn't asked for, and even if done, `staffService`/`staffRepository`
never expose a `username` field (username lives on `users`, not
`staff` — already documented in `49c2c36`'s commit message), so the
match would need `staff.user_id === cls.tutor_user_id` instead — a
real, correctly-typed join, but building it is left to whichever
future slice actually repoints `staffList`'s reads, not invented here.
Every rename in this slice (`.tutor_id` -> `.tutor_user_id`,
`.className` -> `.class_name`) is scoped to making `classesList`
itself display real data correctly; it does not attempt to fix the
now-permanently-mismatched staff-name lookups downstream of it.

## Key design decision: fixed a pre-existing className/class_name typo, found in the exact code path being touched
`HodDashboard.jsx` line ~2079 (now the "Class Tutor Assignments" panel)
read `cls.className` while every other reference to the same
`classesList` entries in both dashboards reads `cls.class_name` (snake
case) — a pre-existing bug, not introduced by this slice (confirmed by
checking `git log -p` on the surrounding lines predates this session).
`PrincipalDashboard.jsx`'s equivalent panel had the identical bug.
Both fixed to `.class_name` as part of this slice, since it sits
directly in the render path of the exact data being repointed here
(leaving it would mean the class name silently renders as `undefined`
for the very panel meant to prove the repoint works) — not a
speculative unrelated cleanup.

## Key design decision: what's out of scope, and why it can't be closed here
- **`TutorClass.jsx`'s main timetable panel** (`settings.timetable_status`/
  `timetable_data`/`timetable_remarks`, currently from
  `GET /api/tutor/class-settings?tutor_id=`) — **not repointed**. There
  is no "find the class row for the currently authenticated tutor"
  endpoint: `classRepository.findByTutorUserId` was deliberately left
  unwrapped by `academicService` (second slice) and never exposed by
  `routes/classes.js` (third slice) — a caller would need to already
  know the class `id` to `GET /api/v1/classes/:id`, and nothing today
  maps "the logged-in user" to "their own class row." Wiring that up
  is new API surface, not a frontend rename — explicitly out of scope
  per this task's own instructions.
- **`TutorClassMonitor.jsx`** — **not touched at all**. Its
  `/api/monitor/tutor-classes` composite (class + roster + attendance)
  has no real-API equivalent to repoint to; building one would mean
  inventing a student-roster-per-class join that doesn't exist and
  attendance fields that belong to a module (5) not yet built.
- **Tutor-linking writes** (`HodDashboard.jsx`'s
  `POST /api/hod/link-tutor` inside `handleStaffFormSubmit`,
  `PrincipalDashboard.jsx`'s `handleLinkTutor`) — **not repointed**.
  Tutor assignment already works at the DB/API level via generic
  `PUT /api/v1/classes/:id` with `tutor_user_id` (third slice), but
  the UI's linking flow is keyed on `staff_username`, which has no
  real-API equivalent to resolve to a `user_id` without also
  repointing `staffList` — same reasoning as the design decision
  above. Left exactly as-is, still writing to a dead endpoint.
- **Timetable review actions** (`handleTimetableReview` in both
  dashboards, `POST /api/hod/timetable-review` /
  `/api/principal/timetable-review`) — **not repointed**. This is real
  HOD/Principal approval-chain logic; CLAUDE.md rule 3 makes
  `WorkflowService` (Module 8) the sole approval gate, and it doesn't
  exist yet — same boundary the second and third Module 3 slices
  already drew and documented.
- **`pendingTimetables`** (`GET /api/timetable/pending`) and
  **`monitorData`** (`GET /api/monitor/tutor-classes`) in both
  dashboards — **not touched**. Neither has a real-API replacement
  today for the same reasons as `TutorClassMonitor.jsx` above.

## Files likely affected
- `frontend/src/pages/HodDashboard.jsx`
- `frontend/src/pages/PrincipalDashboard.jsx`
- `frontend/src/pages/TutorClass.jsx`

## Exact changes
In all three files: the `classesList`/`deptClasses` fetch URL changes
from `/api/hod/classes` to `/api/v1/classes`, gains an
`Authorization: Bearer ${accessToken}` header (`GET /classes` is
`requireAuth`-gated — none of these fetches sent one before, since the
old endpoint never checked auth at all, having never existed), and its
response handling changes from `data.classes` (old envelope) to
`data`/`classData` directly (`routes/classes.js` returns a bare
array). Every downstream read of a `classesList`/`deptClasses` entry's
`.tutor_id` becomes `.tutor_user_id`; the two `.className` typos
become `.class_name`. `TutorClass.jsx` additionally destructures
`accessToken` from `useAuth()` (wasn't pulled in before).

## Acceptance criteria
- `npm run build` (frontend) succeeds with no errors.
- Live, end-to-end proof (not just static review) that the new
  request shape matches: seeded a real tenant + principal user + two
  real `classes` rows (one with a `tutor_user_id`, one without) in the
  live Docker Postgres, logged in through the real `/api/v1/auth/login`,
  and called `GET /api/v1/classes` with that token exactly as the
  frontend now does — confirms a bare array, `class_name`,
  `tutor_user_id` (UUID or `null`), `semester`, `department`, and that
  the same call without an `Authorization` header gets a real 401 (not
  silently wrong data).
- Vite serves all three edited files with 200 (no transform/syntax
  errors) and the served source reflects the new field names.
- No backend files touched — this slice is UI-only, matching Module
  2's fourth slice's own scope.
