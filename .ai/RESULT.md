# RESULT

## Files changed
- `backend/migrations/1752100000000_module-4-attendance-schema.js` (new)
- `backend/src/repositories/attendanceRepository.js` (new)

## What changed, per file
- `1752100000000_module-4-attendance-schema.js`: creates
  `attendance_sessions` — `id`, `college_id` (FK -> `colleges`),
  `class_id` (FK -> `classes`, replacing the prototype's `tutor_id`
  username), `session_date`, `hour_index` (1-based, matches
  `classes.timetable_data`'s grid columns), `marked_by_user_id`
  (NOT NULL FK -> `users` — a row's existence *is* "already marked",
  there's no separate pending state), `absent_student_ids` (JSONB
  array of `students.id` UUIDs, default `'[]'`), `total_students`
  (roster snapshot), `locked_at` (nullable — state representable, no
  transition logic yet), `deleted_at` (nullable — soft-delete,
  resolved now per BusinessRules.md's AI section, not left open like
  students/staff/classes were). RLS enabled + forced with a
  `tenant_isolation` policy, identical pattern to Module 0-3. A
  **partial** unique index,
  `attendance_sessions_class_date_hour_key` on
  `(class_id, session_date, hour_index) WHERE deleted_at IS NULL` —
  new pattern in this schema, needed because a plain `UNIQUE` would
  permanently block re-marking a period whose row was soft-deleted.
  `GRANT SELECT, INSERT, UPDATE` only to `arcnave_app` — **no
  `DELETE`**, enforced at the DB permission level, not just by the
  repository never issuing one. `down` drops the table.
- `attendanceRepository.js`: `create`, `findById`,
  `findByClassSessionAndHour` (the "already marked?" lookup),
  `findByClassAndDate`, `update` (partial), `softDelete` (no hard
  `remove` exists at all), `list` (paginated) — mirrors
  `classRepository.js`'s shape, adapted for soft-delete: every read
  function filters `deleted_at IS NULL`. Raw SQL confined to this
  file, no calls to other repositories, no business logic/validation
  beyond what Postgres itself enforces.

## Grounding notes worth restating
`StaffDashboard.jsx` (not `TutorClass.jsx`) is the real shape this ERD
is built against — its `GET /api/staff/my-schedule` /
`POST /api/staff/mark-period-attendance` pair is the only real,
working flow that carries actual per-student identity
(`absent_rolls`) through to a network call. `TutorClass.jsx`'s "Live
Attendance" widget only ever posts a manually-typed aggregate count
(`present_today`/`present_this_hour`); the individual students it lets
a tutor check off (`markedAbsentees`) are computed into a number and
never actually sent anywhere — a dead end for grounding a real
per-period record shape, used here only for the window/lock/scheduled-
staff gating rules it does visibly enforce client-side. Full reasoning
in `.ai/TASK.md`.

## Known open gap, carried forward from Module 3, not solved here
Nothing can set `classes.timetable_status` to `'Approved'` through any
real API yet (`WorkflowService`, Module 8, doesn't exist) — flagged
again in `.ai/TASK.md` per this session's explicit instruction not to
work around it. The live verification below had to set it with a raw
`UPDATE classes SET timetable_status = 'Approved'` run directly
against Postgres as `arcnave_admin`, exactly the kind of bypass a real
service would never be allowed to do — acceptable only because this is
ERD-layer verification, not a service/route being exercised.

## Tests
This sandbox has the same real, already-running Docker Postgres
(`arcnave-blueprint-db-1`) Module 3's third/fourth slices found — no
embedded-postgres scratch harness needed this time. Ran, against the
live database, in this order:

1. **`up`** — `npm run migrate` applied the one new migration cleanly.
2. **Schema inspection** (`\d attendance_sessions`, `\dp
   attendance_sessions`) — every column, FK, the partial unique index,
   and the RLS policy match the migration exactly; `arcnave_app`'s
   grants show `arw` (SELECT/INSERT/UPDATE) with no `d` (DELETE) —
   confirmed directly from Postgres's own catalog, not just re-read
   from the migration file.
3. **Repository exercised live** through the real `arcnave_app` role,
   inside real `SET LOCAL app.current_tenant = '<college>'`
   transactions (a hand-rolled `withTenant` helper matching what
   Tenant Middleware does on a real request), against two seeded
   tenants with real `colleges`/`users`/`classes` rows — every check
   passed:
   - `create()` — PASS, including confirming an omitted
     `absentStudentIds` defaults to `[]` (not `NULL`).
   - `findById()` — PASS.
   - `findByClassSessionAndHour()` — PASS, both the "found" and
     "not yet marked" (`null`) cases.
   - `findByClassAndDate()` — PASS, returned ordered by `hour_index`.
   - `update()` (re-marking a period) — PASS.
   - **Partial unique index** — PASS, proven twice: (a) a second
     `create()` for the same live `(class_id, session_date,
     hour_index)` raised a real `23505` on
     `attendance_sessions_class_date_hour_key`; (b) after
     `softDelete()`-ing the conflicting row, a `create()` for the
     identical key succeeded — proves soft-delete doesn't permanently
     block re-marking, the actual reason a partial (not plain) index
     was chosen.
   - **`softDelete()`** — PASS: the row immediately disappears from
     `findById()`; a second `softDelete()` call on the same id returns
     `null` (idempotent, no error).
   - **No hard-delete possible** — PASS: a raw `DELETE FROM
     attendance_sessions ...` issued as `arcnave_app` (not just
     "the repository doesn't call it" — an actual attempted bypass)
     raised Postgres's own `42501 permission denied for table
     attendance_sessions`.
   - **FK enforcement** — PASS, both directions: a nonexistent
     `class_id` raised `attendance_sessions_class_id_fkey`; a
     nonexistent `marked_by_user_id` raised
     `attendance_sessions_marked_by_user_id_fkey`.
   - **Cross-tenant RLS isolation** — PASS, the release-gate check
     Architecture.md requires: a session created under tenant A was
     invisible to tenant B via both `findById()` (`null`, not the
     row) and `list()` (returned exactly tenant B's own one row).
   - `list()` — PASS, excluded the soft-deleted row, returned exactly
     the two remaining live rows for that tenant.
4. **`down` reverts only `attendance_sessions`** — PASS. Ran with an
   explicit `count: 1` (not `scripts/migrate.js`'s `count: Infinity`).
   `to_regclass('public.attendance_sessions')` -> `null`;
   `classes`/`staff`/`students` all still resolved.
5. **Re-applied `up`, final state** — PASS. `attendance_sessions`
   exists again, empty.
6. **Full backend suite** (`npm test`, 186 tests across 16 files) —
   PASS, no regressions. No new test file added in this slice: no
   service or API exists yet to test against (matching Module 3's
   first slice, which also added no test file — the live verification
   above is this slice's proof, same as that slice's).
7. `node --check` on both new files — PASS, no syntax errors.
8. All seeded verification data (two scratch tenants, their users,
   classes, and attendance sessions) cleaned up afterward — nothing
   left in the shared Docker Postgres.

## Flags / open questions
- **Attendance/timetable-approval gate unreachable end-to-end** —
  restated from Module 3, not solved: `classes.timetable_status`
  cannot reach `'Approved'` via any real API without `WorkflowService`
  (Module 8). This module's *second* slice (`AttendanceService`) will
  need to enforce "reject marking if the class's timetable isn't
  `Approved`" as pure validation logic even though nothing can
  legitimately flip that flag yet — the same shape of gap
  `staffService`/`studentService` already carry for their own
  WorkflowService-shaped holes.
- **No per-student `attendance_records` table** — deliberate scope
  boundary (see `.ai/TASK.md`'s design-decision section): the real,
  working frontend only ever operates per-period. Revisit if/when
  Reports/Analytics (Modules 7/10) need per-student historical
  queries.
- **`locked_at` has no transition logic** — the column exists (per
  BusinessRules.md's rule), but nothing sets it yet; deferred to a
  later Attendance slice, same treatment `timetable_status` got in
  Module 3's first slice before its literal values were used for
  anything.
- **`absent_student_ids` has no FK-level integrity** — a JSONB array
  can't be FK-constrained element-by-element in Postgres; validating
  each id is a real `students.id` in this tenant is Service-layer
  work, not modeled here (same trade-off `classes.timetable_data`'s
  free-text cells already accepted in Module 3).
- **No service, API route, UI, or `docs/modules/` file touched in this
  slice** — matches every prior module's first-slice scope exactly.
