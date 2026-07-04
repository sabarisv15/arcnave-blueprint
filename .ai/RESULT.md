# RESULT

## Files changed
- `backend/migrations/1752200000000_module-3-timetable-normalization-schema.js` (new)
- `backend/src/repositories/timetablePeriodRepository.js` (new)
- `backend/src/repositories/facultyAllocationRepository.js` (new)

## What changed, per file
- `1752200000000_module-3-timetable-normalization-schema.js`: creates
  `timetable_periods` (the shared, college-wide bell schedule — `id`,
  `college_id` FK, `day_of_week`, `hour_index`, `start_time`,
  `end_time`, `UNIQUE (college_id, day_of_week, hour_index)`) and
  `faculty_allocation` (the real join — `id`, `college_id` FK,
  `class_id` FK -> `classes`, `period_id` FK -> `timetable_periods`,
  `subject` (still free text), `staff_user_id` FK -> `users`
  (nullable), `UNIQUE (class_id, period_id)`,
  `UNIQUE (period_id, staff_user_id)`). RLS enabled + forced on both
  with a `tenant_isolation` policy, identical to every prior table.
  `GRANT SELECT, INSERT, UPDATE, DELETE` to `arcnave_app` on both — the
  same open-question placeholder students/staff/classes got, not
  `attendance_sessions`'s resolved soft-delete treatment (neither
  table is named by BusinessRules.md's AI hard-delete restriction).
  `classes.timetable_data` is completely untouched. `down` drops
  `faculty_allocation` then `timetable_periods` (FK order).
- `timetablePeriodRepository.js`: `create`, `findById`,
  `findByCollegeDayAndHour`, `update`, `remove` (hard delete), `list`
  — mirrors `classRepository.js`'s shape.
- `facultyAllocationRepository.js`: `create`, `findById`,
  `findByClassAndPeriod`, `findByClassId`, `findByStaffUserId`,
  `update`, `remove` (hard delete), `list` — same shape, never calls
  `timetablePeriodRepository.js` or `classRepository.js` (CLAUDE.md
  rule 4). `findByStaffUserId` is the real, structured link a future
  AttendanceService slice needs to finally verify "the staff member
  scheduled for that period" — not consumed by anything yet, only
  enabled, per this slice's own scope (ERD + repository, no
  service/API).

## Tests
No test file added — matches every prior first-of-a-slice-family (no
service or API exists yet to test against). Live-verified against the
real, already-running Docker Postgres instead, through the real
`arcnave_app` role inside real `SET LOCAL app.current_tenant`
transactions, seeding two real tenants with real `colleges`/`users`/
`classes` rows:

1. **`up`** — applied cleanly (one new migration).
2. **Schema inspection** (`\d timetable_periods`, `\d
   faculty_allocation`) — every column, FK, UNIQUE constraint, and RLS
   policy match the migration exactly.
3. **Repository checks, all PASS**:
   - `timetablePeriodRepository.create`/`findByCollegeDayAndHour`/
     `update` — correct.
   - `UNIQUE (college_id, day_of_week, hour_index)` — a real duplicate
     insert raised `timetable_periods_college_id_day_of_week_hour_index_key`.
   - **The "shared" design decision, proven concretely**: the exact
     same `timetable_periods` row (Monday, Hour 1) was referenced by
     two *different* classes' `faculty_allocation` rows — not just
     asserted in a comment, actually exercised.
   - A non-teaching slot (`subject: 'Lunch'`, no `staff_user_id`) —
     representable, as designed.
   - `UNIQUE (class_id, period_id)` — a second allocation for the same
     class+period raised `faculty_allocation_class_id_period_id_key`.
   - `UNIQUE (period_id, staff_user_id)` — proven against a genuinely
     *different* class (not the same class/period pair, which would
     hit the other constraint first): assigning the same staff member
     to a third class during an already-occupied period raised
     `faculty_allocation_period_id_staff_user_id_key` — real
     double-booking prevention.
   - Two different classes with `staff_user_id IS NULL` at the same
     period coexisted without error — the NULL-distinctness proof,
     same technique as `classes_tutor_user_id_key`'s in Module 3's
     first slice.
   - `findByClassAndPeriod`/`findByClassId`/`findByStaffUserId` — all
     correct; `findByStaffUserId` returned exactly the one real
     allocation for that staff member, concrete proof this is now a
     genuinely queryable "this person's teaching schedule" link.
   - FK enforcement — real, on all three: nonexistent `class_id`
     raised `faculty_allocation_class_id_fkey`, nonexistent `period_id`
     raised `faculty_allocation_period_id_fkey`, nonexistent
     `staff_user_id` raised `faculty_allocation_staff_user_id_fkey`.
   - **FK `RESTRICT` proof**: attempting to `remove()` a
     `timetable_periods` row still referenced by a `faculty_allocation`
     row was rejected with a real `23503` on
     `faculty_allocation_period_id_fkey` — confirms the deliberate
     absence of any `ON DELETE` override behaves as intended. Removing
     the dependent allocation first, then the period, succeeded.
   - **Cross-tenant RLS isolation** — PASS on both new tables: a
     period/allocation created under tenant A was invisible to tenant
     B via both `findById()` (`null`) and `list()` (returned only
     tenant B's own rows).
4. **`down` reverts only the two new tables** — PASS, explicit
   `count: 1`. `to_regclass('public.timetable_periods')` and
   `to_regclass('public.faculty_allocation')` both -> `null`;
   `classes`, `attendance_sessions`, `staff` all still resolved.
5. **Re-applied `up`, final state** — PASS, both tables exist again,
   empty.
6. **Full backend suite** (`npm test`, 203 tests) — PASS, no
   regressions.
7. `node --check` on all three new files — PASS.
8. All seeded verification data cleaned up afterward.

Note: this session's Docker container (`arcnave-blueprint-db-1`) had
stopped since the prior session (as it did between the two Module 4
slices too) — `docker start` brought it back with all data intact on
its persistent volume, no re-seeding of Module 0-4's schema needed.

## Flags / open questions
- **Not consumed yet** — `faculty_allocation`/`timetable_periods` are
  pure additive structure. Nothing in `academicService.js` or
  `attendanceService.js` reads from them yet; closing the "scheduled
  staff member" authorization gap flagged in `82f8479` needs a future
  Attendance (or Academic) slice to actually call
  `facultyAllocationRepository.findByClassAndPeriod`/
  `findByStaffUserId` and wire the result into
  `attendanceService.assertCanMark`. Not attempted here — this slice's
  scope is ERD + repository only.
- **No CSV-upload-to-normalized-rows population path** — the real,
  working frontend's timetable upload (`TutorClass.jsx`'s
  `handleTimetableUpload`) still only writes to
  `classes.timetable_data`. A future slice will need to decide how (or
  whether) uploading a timetable also populates `faculty_allocation` —
  real `AcademicService` business logic, not decided or guessed at
  here.
- **No normalized `subjects` table** — unchanged from Module 3's
  original first-slice decision; `faculty_allocation.subject` stays
  free text, matching the task's own explicit column list.
- **No soft-delete on either table** — same open-question treatment as
  students/staff/classes; revisit only if a future rule names these
  tables the way BusinessRules.md's AI section names
  `attendance_sessions`.
- **No service, API route, UI, or `docs/modules/` file touched in this
  slice** — matches every prior module's first-of-a-slice-family scope
  exactly.
