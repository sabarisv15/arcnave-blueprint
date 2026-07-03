# TASK

## Objective
Module 4 (Attendance), first vertical slice: ERD + migration +
repository only for an `attendance_sessions` table — no service/API/UI
yet. Same discipline as Module 1/2/3's first slices (`fbfd1c9`,
`31f5a8b`, `ef0a76c`): model exactly what's grounded in the real,
working frontend, flag what's deferred, don't invent structure nobody
asked for yet.

## Known open gap carried in from Module 3, restated here (not solved)
Module 3's fourth slice (`dbe8380`) flagged that nothing can set
`classes.timetable_status` to `'Approved'` via any real API yet — HOD/
Principal approval actions require `WorkflowService` (Module 8), which
doesn't exist. CLAUDE.md rule 7 / BusinessRules.md Academic/Timetable:
"A class's attendance cannot be marked until its timetable status is
`Approved`." This means **no attendance session built in this module
can be end-to-end gated for real yet** — the only way to get a
`classes` row into `'Approved'` state today is a raw
`UPDATE classes SET timetable_status = 'Approved'` run directly
against Postgres (bypassing the API entirely), which is exactly what
this slice's own live verification had to do to seed test data. This
is restated deliberately, not silently worked around: Roadmap.md locks
Module 4 after Module 3 regardless, and CLAUDE.md rule 1 (only
Business Services touch data) makes the *service-layer enforcement* of
this lock the real requirement — this slice is the ERD layer, which
has no gate to enforce yet at all. The service-layer gate (checking
`classes.timetable_status === 'Approved'` before allowing a mark) is
explicitly deferred to Attendance's second slice, and the
`WorkflowService`-shaped gap that makes `'Approved'` unreachable via
any real API stays exactly as open as Module 3 left it.

## Grounding (read before assuming any field list)
- `docs/architecture/BusinessRules.md` Attendance section: "Attendance
  is marked hour-wise, within a defined attendance window,"
  "Attendance cannot be modified after it is locked," "Only the staff
  member scheduled for that period, the class tutor, or an HOD
  (force-mark) may mark attendance for a given hour."
- `docs/architecture/Architecture.md` 2.5: `AttendanceService` "owns
  hour-wise attendance, attendance windows, lock; reads (does not own)
  timetable/approval state from AcademicService."
- `docs/architecture/BusinessRules.md` AI section: "The AI is never
  given a hard-delete capability on attendance, fees, or marks
  records, even with approval — only soft-delete (a flag/timestamp)."
  Names this table by domain, explicitly — unlike students/staff/
  classes (all left soft-delete an open question), this is a resolved
  rule for attendance specifically. Resolved at the ERD level in this
  slice, not deferred again.
- `frontend/src/pages/StaffDashboard.jsx` — the real, working
  per-student attendance-marking screen (grounded ahead of
  `TutorClass.jsx`'s attendance widget, which only ever POSTs an
  aggregate `present_today`/`present_this_hour` count to
  `/api/tutor/live-attendance`, never individual students — see the
  design decision below for why `StaffDashboard.jsx` is the real shape
  to build against, not `TutorClass.jsx`):
  - `GET /api/staff/my-schedule` returns `schedule`: one entry per
    period, each carrying `hour`, `time`, `hour_index`, `class_name`,
    `subject`, `staffDisplay`, `tutor_id`, `already_marked`, and — only
    once marked — `period_record: { absent_rolls, present, total }`.
  - `POST /api/staff/mark-period-attendance` body:
    `{ tutor_id, hour_index, absent_rolls, date_key }` — marks (or
    re-marks) exactly one period for one class on one date, submitting
    the list of absent students' roll numbers, present is implied
    (roster minus absent).
  - The "Mark Attendance" panel operates per-student (a checklist of
    `selectedPeriod.students`, toggling each into/out of
    `absentRolls`), but the wire payload is period-level: one absence
    list per (class, date, hour), not one row submitted per student.
- `frontend/src/pages/TutorClass.jsx`'s attendance-marking UI: the
  `isMarkingWindowOpen` gate (window open only within the first 15
  minutes of a period's start, per its timetable-parsed
  `getCurrentPeriod`), `isUserAllowedToMark`/`isScheduledStaff` (staff
  scheduled for that period, matched by parsing the timetable cell
  text), and `settings.timetable_status !== 'Approved'` blocking
  marking entirely — this is where the "attendance window" and
  "timetable must be Approved" rules are visibly enforced client-side
  today (not persisted, but confirms these are real, exercised
  concepts, not just BusinessRules.md prose).

## Key design decision: one row per (class, date, hour), not one row per student
`attendance_sessions`, not a normalized `attendance_records`
per-student join table. Grounded directly in
`POST /api/staff/mark-period-attendance`'s actual wire shape — one
call marks one period, carrying the full absence list for that period
in a single request — and in `period_record`'s read shape, which is
always read back as one object per period, never as N per-student
rows. Same reasoning Module 3's first slice used to reject normalizing
subjects/periods/faculty_allocation out of `classes.timetable_data`:
nothing in the real, working frontend queries "every attendance row
for student X across all sessions" as a structured filter today —
every real screen (`StaffDashboard.jsx`'s schedule,
`TutorClass.jsx`'s current-period display) operates per-period, not
per-student. A future Reports/Analytics module (7, 10 — much later in
Roadmap.md) will likely want per-student attendance percentages, but
building a normalized join table now, for a consumer that doesn't
exist yet, is exactly the "structure nobody has asked for yet"
Module 3's own `.ai/TASK.md` already ruled out for the identical
reason. Revisit only once a real screen needs that query shape.

## Key design decision: TutorClass.jsx's aggregate counter is not the grounding source
`TutorClass.jsx`'s "Live Attendance" widget
(`handleSaveLiveAttendance` -> `POST /api/tutor/live-attendance`,
body `{ tutor_id, present_today, present_this_hour }`) never names
individual students at all — it's a manually-typed aggregate counter,
not a real roll-call. `markedAbsentees` (the roll numbers the tutor
actually checks off in that same screen) is computed into a count and
then thrown away — never sent to the backend. This is a materially
weaker, dead-end shape compared to `StaffDashboard.jsx`'s real
`mark-period-attendance` flow, which does carry real per-student
identity (`absent_rolls`) end-to-end. `StaffDashboard.jsx` is treated
as the authoritative shape for this ERD; `TutorClass.jsx`'s aggregate
counter is grounding only for the *window/lock/scheduled-staff gating
rules* (see above), not for the attendance record's own shape.

## Key design decision: class_id (real FK), not tutor_id (prototype username)
The prototype identifies a period by `tutor_id` (a username string) in
both `my-schedule` and `mark-period-attendance`, because in the old
model a tutor uniquely identified "their" class. The real `classes`
table (Module 3) is the actual class identity now — `class_id UUID`
FK to `classes(id)` replaces `tutor_id`, the same `tutor_id` ->
`tutor_user_id` shift Module 3's fourth slice already made on the read
side. Resolving "which class is this staff member's scheduled period
for" from a `class_id` is Service-layer work, not modeled here.

## Key design decision: absent_student_ids stores real students.id UUIDs, not roll numbers
The wire shape (`absent_rolls`) is human-facing roll-number strings —
that's what a prototype with no auth-resolved identity behind it sends
today. Storing roll numbers directly in the ERD would duplicate free
text as if it were identity, the same trap CLAUDE.md rule 8 /
BusinessRules.md's Students section already warns against for Aadhaar
(never trust free-text as identity). `absent_student_ids` is JSONB, an
array of `students.id` UUIDs — the resolved form a real
`AttendanceService` would produce after translating `roll_no` ->
`student_id`, same layering `staffService.createStaff` already
established (takes an already-resolved `userId`, never a raw
username). No FK-level enforcement on the JSONB array elements (same
trade-off `classes.timetable_data`'s free-text subject/staff cells
already accepted) — that's a Service-layer validation job, not a DB
one, for this slice.

## Key design decision: locked_at is added now, even though no real code enforces the lock yet
BusinessRules.md states "Attendance cannot be modified after it is
locked" as a flat rule — but `StaffDashboard.jsx`'s own "Update
Attendance" button re-marks an already-marked period indefinitely,
with no lock check anywhere in the real, working frontend. CLAUDE.md's
"prototype validated scope only, not the foundation" framing makes
BusinessRules.md authoritative over what the prototype currently does
here, not the other way around — same reasoning Module 3 added
`timetable_status`'s known value set to its ERD before any real
transition logic enforced those values. `locked_at TIMESTAMPTZ`
(nullable, unset by this slice) makes the state representable; the
actual lock transition (who locks a session, and when) is real
business logic, explicitly deferred to a later Attendance slice.

## Key design decision: deleted_at (soft-delete) resolved now, not left open like students/staff/classes
Every prior module's first slice left soft-delete "an open question"
(no column, `DELETE` granted as a placeholder). This slice does not
repeat that: BusinessRules.md's AI section is a resolved rule naming
attendance by domain — "never given a hard-delete capability on
attendance ... only soft-delete." `deleted_at TIMESTAMPTZ` resolves it
at the ERD level. The `GRANT` deliberately **omits** `DELETE` to
`arcnave_app` — defense in depth beyond just
`attendanceRepository.js` never issuing a `DELETE` statement: even a
buggy or compromised service call is structurally unable to hard-
delete this table, verified live (see Acceptance criteria).

## Key design decision: a partial UNIQUE index, not a plain UNIQUE constraint
`UNIQUE (class_id, session_date, hour_index) WHERE deleted_at IS NULL`
— a plain `UNIQUE` constraint would permanently block ever re-marking
a period whose session row was soft-deleted. No other table in this
schema needed this (none of them have `deleted_at` yet), so this
pattern is new here, not copied from a prior migration.

## Files likely affected
- `backend/migrations/1752100000000_module-4-attendance-schema.js` (new
  — next timestamp after `1752000000000_module-3-academic-schema.js`)
- `backend/src/repositories/attendanceRepository.js` (new)

## Exact changes

**ERD — `attendance_sessions` table** (tenant-scoped, RLS per
BusinessRules Multi-tenancy, same pattern as `classes`/`students`/
`staff`):
- `id` UUID PK, default gen
- `college_id` TEXT NOT NULL, FK -> `colleges(college_id)`
- `class_id` UUID NOT NULL, FK -> `classes(id)`
- `session_date` DATE NOT NULL
- `hour_index` INT NOT NULL — 1-based column position into
  `classes.timetable_data`'s grid, no CHECK constraint (matches house
  convention: known real values/ranges documented in comments only)
- `marked_by_user_id` UUID NOT NULL, FK -> `users(id)` — a row only
  exists once marked; there is no "pending/unmarked" row state
- `absent_student_ids` JSONB NOT NULL DEFAULT `'[]'`
- `total_students` INT NOT NULL — roster-size snapshot at mark time
- `locked_at` TIMESTAMPTZ, nullable
- `deleted_at` TIMESTAMPTZ, nullable (soft-delete)
- `created_at`, `updated_at` TIMESTAMPTZ

No Aadhaar column (CLAUDE.md rule 8). No per-student
`attendance_records` join table (see design decision above).

**Migration** (`node-pg-migrate`, reversible per CLAUDE.md rule 6):
- `up`: create `attendance_sessions` as above, a partial unique index
  `attendance_sessions_class_date_hour_key` on
  `(class_id, session_date, hour_index) WHERE deleted_at IS NULL`,
  enable + force RLS, `tenant_isolation` policy on `college_id`
  (identical pattern to Module 1/2/3). `GRANT SELECT, INSERT, UPDATE`
  only — no `DELETE` — to `arcnave_app`.
- `down`: drop table.

**Repository** (`attendanceRepository.js`, mirrors `classRepository.js`'s
shape — query mechanics only, no business logic, never calls another
repository per CLAUDE.md rule 4):
- `create(client, fields)`
- `findById(client, id)` — filters `deleted_at IS NULL`
- `findByClassSessionAndHour(client, classId, sessionDate, hourIndex)`
  — the "already marked?" lookup `StaffDashboard.jsx`'s real schedule
  screen needs
- `findByClassAndDate(client, classId, sessionDate)` — a class's
  marked periods for one day, ordered by `hour_index`
- `update(client, id, fields)` (partial, same entries-filter pattern
  as `classRepository.update`)
- `softDelete(client, id)` — sets `deleted_at`, not a `DELETE`
  statement; idempotent against an already-deleted or missing id.
  There is **no** hard-delete function in this repository at all.
- `list(client, { limit, offset })` — filters `deleted_at IS NULL`

## Acceptance criteria
- Migration runs `up` and `down` cleanly against a DB that already has
  Module 0-3 applied.
- RLS enabled + forced, `tenant_isolation` policy present, matches the
  `classes`/`students`/`staff` pattern exactly.
- `arcnave_app` has no `DELETE` privilege on `attendance_sessions` —
  proven with a real `DELETE` statement rejected by Postgres itself
  (`42501`), not just by inspecting the GRANT.
- The partial unique index rejects a duplicate live
  `(class_id, session_date, hour_index)`, but allows re-inserting the
  same key after the conflicting row is soft-deleted — proven with
  real inserts, not just read from the DDL.
- `softDelete` hides a row from every read function immediately, and
  is idempotent against a second call.
- FK violations on both `class_id` and `marked_by_user_id` are
  real, from genuine Postgres constraints.
- Cross-tenant RLS isolation proven through the repository (not raw
  SQL as superuser): a session created under tenant A is invisible to
  tenant B via both `findById` and `list`.
- No Aadhaar column anywhere. No per-student join table (this slice's
  scope boundary, see design decision above).
- Repository has zero references to Storage, other repositories, or
  business-service logic.
- No service, API route, UI, or `docs/modules/` file touched in this
  slice — matches every prior module's first-slice scope exactly.
- Full backend test suite (186 tests) still passes — this slice adds
  no test file of its own (no service/API exists yet to test; the
  live verification proving the schema and repository work is
  recorded in `.ai/RESULT.md`, same as Module 3's first slice).
