# RESULT

## Files changed
- `frontend/src/pages/HodDashboard.jsx`
- `frontend/src/pages/PrincipalDashboard.jsx`
- `frontend/src/pages/TutorClass.jsx`

No backend files touched — this slice is UI-only, matching Module 2's
fourth slice (`49c2c36`).

## What changed, per file
- **`HodDashboard.jsx`**: `loadData`'s `classRes` fetch now hits
  `GET /api/v1/classes` with `Authorization: Bearer ${accessToken}`
  (was `/api/hod/classes`, no auth header, always 404'd), and
  `setClassesList(classData)` replaces `setClassesList(classData.classes)`
  since the real route returns a bare array. Every downstream read of
  a `classesList` entry updated `tutor_id` -> `tutor_user_id`: the
  `selectedTimetableTutor`/`selectedDashboardTutor` default-selection
  effect, `openEditStaff`'s `matchedClass` lookup, the "Class Tutor
  Assignments" panel (display + badge), and the staff-directory's
  matched-class badge. Also fixed a pre-existing `cls.className` ->
  `cls.class_name` typo in the Class Tutor Assignments panel (see
  `.ai/TASK.md`'s design-decision section — predates this session).
- **`PrincipalDashboard.jsx`**: identical fetch repoint (`classData || []`
  instead of `classData.classes || []`). `handleLinkTutor`'s
  `targetCls.className` -> `targetCls.class_name` (inside the
  still-dead `/api/hod/link-tutor` write path, fixed for consistency
  since it reads from the now-repointed `classesList`, not because
  that write path itself does anything today). The "Class Tutor
  Assignments" (Assign Tutor) panel: `cls.className` -> `cls.class_name`,
  `cls.tutor_id` -> `cls.tutor_user_id` on the `<select>`'s `value`.
- **`TutorClass.jsx`**: added `accessToken` to its `useAuth()`
  destructure (wasn't pulled in before). The HOD-only `deptClasses`
  fetch repointed the same way, with `Array.isArray(data)` replacing
  the old `data && data.classes` envelope check. The "Department
  Classes" `<optgroup>`: `c.tutor_id`/`c.className` -> `c.tutor_user_id`/
  `c.class_name`.

## What's deliberately still on the old, dead endpoints (see .ai/TASK.md for the full reasoning)
- `TutorClass.jsx`'s main timetable panel (`/api/tutor/class-settings?tutor_id=`)
  — blocked on a missing "find my own class" endpoint; not invented here.
- `TutorClassMonitor.jsx` (`/api/monitor/tutor-classes`) — untouched
  entirely; no real-API equivalent exists (needs a student-roster join
  and Attendance-module fields that don't exist yet).
- Tutor-linking writes (`handleStaffFormSubmit`'s link-tutor call,
  `handleLinkTutor`) and timetable-review actions
  (`handleTimetableReview` in both dashboards) — blocked on
  `WorkflowService` (Module 8) and a `username` -> `user_id`
  resolution that doesn't exist without also repointing `staffList`'s
  reads (out of scope here).
- `pendingTimetables`/`monitorData` in both dashboards — untouched,
  same reasons as `TutorClassMonitor.jsx`.

A direct, known consequence: `staffList` (from the still-dead
`GET /api/hod/staff`) stays permanently empty, so every
`staffList.find(s => s.username === cls.tutor_user_id)` lookup this
slice touches (tutor-name/login display, matched-class badges) now
fails for a type-mismatch reason (comparing a UUID to `undefined`
matches from an empty array either way) instead of an empty-list
reason — net UI behavior is unchanged (still no tutor name resolves),
but the raw `tutor_user_id` UUID now renders in the "@..." badges
where nothing rendered before. This is the accurate, honest
reflection of what the real backend currently contains, not a
regression to patch over.

## Verification
No `chromium-cli`/Playwright available in this sandbox (checked;
neither installed nor reachable via `npx` without a fresh, unauthorized
install) — **no actual browser click-through or screenshot was taken**,
so the panels' visual rendering was not directly observed. What was
verified instead, all against the real, live stack (Docker Postgres +
a real running Express server), not mocks:

1. **`npm run build` (frontend)** — succeeds cleanly, no errors, all
   1510 modules transform (confirms valid JS/JSX syntax across all
   three edited files).
2. **Vite dev server serves all three edited files with 200** — no
   transform/syntax errors; fetched each module's served source
   through the dev server and confirmed it contains `tutor_user_id`
   (i.e., Vite is serving the edited source, not a stale cache).
3. **Live end-to-end API shape proof** — started the real backend
   (`node src/index.js`) against the already-running Docker Postgres,
   seeded a real tenant (`uiverify1`) with a principal user, a tutor
   (staff-role) user, and two real `classes` rows (one with
   `tutor_user_id` set to the tutor's real `users.id`, one with none),
   logged in through the real `POST /api/v1/auth/login`, then called
   `GET /api/v1/classes` with the resulting token using the exact host
   header + Authorization header pattern the frontend code now uses.
   Confirmed:
   - A bare JSON array (not `{ classes: [...] }`) — validates the
     `setClassesList(classData)` change in all three files.
   - `class_name`, `department`, `semester`, `tutor_user_id` (real UUID
     or `null`), `timetable_status`, `timetable_data`, `timetable_remarks`
     all present with the exact names every rename in this slice now
     assumes.
   - The same request **without** an `Authorization` header returns a
     real `401` — proves the header this slice added is actually
     necessary (the old endpoint never checked auth, having never
     existed, so this is new, load-bearing behavior, not a no-op).
   - Cleaned up all seeded data (`uiverify1` college, its users,
     classes, audit_log, refresh_tokens) afterward — nothing left in
     the shared Docker Postgres.
4. Stopped both the backend and Vite dev server processes after
   verification.

**Honest gap**: the actual rendered panels (Class Tutor Assignments in
both dashboards, the Department Classes dropdown in TutorClass.jsx)
were not visually confirmed in a browser. The API-shape proof above
gives high confidence — the JSX consuming this data does only direct
property reads (`cls.class_name`, `cls.semester`, `cls.tutor_user_id`)
with no complex derivations that could throw on the real shape — but
this is inference from a matching data contract, not an observed
screenshot. Flagging per CLAUDE.md's UI-verification instruction
rather than claiming a browser check that didn't happen.

## Flags / open questions
- **`staffList` reads remain unrepointed** — the natural next step to
  make tutor-name display actually work (matching real
  `staff.user_id === cls.tutor_user_id` instead of the dead
  `username` comparison) is a `staffList` GET repoint, not attempted
  here; see the design-decision section in `.ai/TASK.md`.
- **No "find my own class" endpoint** — blocks repointing
  `TutorClass.jsx`'s actual timetable/attendance-lock display, which
  is arguably the more central piece of BusinessRules.md's Academic
  section (CLAUDE.md rule 7). Needs new API surface (e.g., exposing
  `classRepository.findByTutorUserId` through `academicService` and a
  route), a real follow-up slice, not scope creep here.
- **`TutorClassMonitor.jsx` fully blocked** — needs both a real
  student-roster-per-class join and Attendance-module (5) fields;
  revisit once those exist.
- **Tutor-linking and timetable-review writes stay on dead endpoints**
  — blocked on `WorkflowService` (Module 8), consistent with every
  prior Module 3 slice's documented scope boundary.
