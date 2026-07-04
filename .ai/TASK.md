# TASK

## Objective
Module 3 (Academic), new vertical slice, going back from Module 4:
`timetable_periods` + `faculty_allocation` — ERD + migration +
repository only, no service/API/UI yet. Same discipline as every
prior first-of-a-slice-family (`fbfd1c9`, `31f5a8b`, `ef0a76c`,
`49c8b4b`).

This is the normalization Module 4's second slice
(`attendanceService.js`, `82f8479`) explicitly triggered: that slice
documented, in its own `.ai/TASK.md`, that "the staff member scheduled
for that period" (BusinessRules.md Attendance's third named eligible
marker) could not be verified, because `classes.timetable_data` is a
free-text CSV grid with no real staff link, and refused to build a
heuristic text-match authorization check to fake it. This slice builds
the real, structured link that makes that verification possible in a
future AttendanceService slice.

## Grounding (read before assuming any field list)
- `attendanceService.js`'s `.ai/TASK.md`/`.ai/RESULT.md` (`82f8479`):
  the exact gap being closed, and the exact reasoning for why
  heuristic text matching was rejected there.
- `classes.timetable_data`'s real, working shape (Module 3 first
  slice, `ef0a76c`, and its frontend grounding in `TutorClass.jsx`/
  `TutorClassMonitor.jsx`): `{ headers: [...], rows: [...] }`, where
  `headers[0]` is `"Day"` and `headers[1..n]` are time-range strings
  (e.g. `"09:00 - 10:00"`) applied identically across every row (day);
  `rows[i][0]` is a day name, `rows[i][1..n]` are cell strings like
  `"DBMS (Dr. Amit)"`, or plain non-teaching labels (`"Lunch"`,
  `"Library"`, `"Sports"`, `"Placement"`). This shape is the direct
  grounding for both new tables' column choices below.
- `classes.tutor_user_id` (Module 2/3) and BusinessRules.md's
  "Resolved (Module 2 kickoff)" entry: a faculty reference is always a
  real `users.id`, never a `staff.id` or a role grant — followed
  verbatim for `faculty_allocation.staff_user_id`, not re-litigated.
- `attendance_sessions.hour_index` (Module 4 first slice, `49c8b4b`):
  already established as "the 1-based column position into
  `classes.timetable_data`'s grid." Reused verbatim as
  `timetable_periods.hour_index` rather than inventing a synonym
  ("period_index") for the identical concept.

## Key design decision: classes.timetable_data is untouched — this is additive, parallel structure
"Ground this against the existing classes.timetable_data shape (don't
lose the display use case)" — taken literally: this migration does not
alter, migrate data out of, or deprecate `classes.timetable_data` in
any way. The real, working frontend (`TutorClass.jsx`/
`TutorClassMonitor.jsx`) still renders the timetable grid straight
from that JSONB blob; nothing in this slice repoints that display.
Keeping both representations in sync (e.g. a future CSV upload
populating `timetable_data` and `faculty_allocation` from the same
parse) is real `AcademicService` business logic, explicitly deferred —
not attempted at the ERD/repository layer, and not a reason to delay
building the structured side now.

## Key design decision: two tables, not one — "period" and "who teaches what" are different scopes
- **`timetable_periods`**: the SHARED bell schedule. One row per
  `(college_id, day_of_week, hour_index)`, giving that slot's
  `start_time`/`end_time`. "Shared" is grounded, not assumed: every
  class's `timetable_data.headers` in the real frontend is the
  identical flat list of time ranges applied across every row — nothing
  in the real, working frontend gives different classes different bell
  times. Scoped to `college_id`, not `class_id`: one bell schedule per
  institution, not one per class or department.
- **`faculty_allocation`**: the real join. One row per
  `(class_id, period_id)` naming the subject taught and the staff user
  teaching it. `day_of_week` is **not** duplicated here — it already
  lives on the referenced `timetable_periods` row, so a class's
  Monday-Hour-1 and Tuesday-Hour-1 allocations are two different rows
  pointing at two different periods, not two columns on one row. This
  matches this slice's own naming exactly: `class_id, period_id,
  subject, staff_user_id` — no separate day column needed once `day`
  lives inside `period_id`'s target.
- `subject` stays free text — no normalized `subjects` table. Module
  3's first slice already decided this ("the real, working frontend
  never queries a separate subjects table"); nothing about closing the
  attendance-authorization gap requires changing that decision, only
  the staff link needed to become real.

## Key design decision: staff_user_id is nullable — absence of a row is "free," not a flag
A period can be a real, named non-teaching slot (the prototype grid's
`"Lunch"`/`"Library"`/`"Sports"`/`"Placement"` cells) with a `subject`
label but no staff assigned — `staff_user_id` is nullable for exactly
this. A period with genuinely nothing scheduled (a blank grid cell)
simply has no `faculty_allocation` row at all for that
`(class_id, period_id)` pair; the absence of a row is "free/
unscheduled," not a special sentinel value. Matches the same
absence-means-absence philosophy `attendance_sessions` already uses
(a row's existence *is* "already marked").

## Key design decision: two UNIQUE constraints, both direct extensions of a precedent already in this schema
- `UNIQUE (class_id, period_id)`: a class can only have one subject/
  staff assignment per period — the free-text grid already enforces
  this implicitly (one cell, one value); this makes it a real
  constraint.
- `UNIQUE (period_id, staff_user_id)`: a staff member cannot be
  double-booked to teach two different classes during the same
  period. Not explicitly requested by name, but a direct extension of
  the exact reasoning `classes`' `UNIQUE (tutor_user_id)` already
  applies to tutor assignment ("Class Tutor is assigned only by HOD,
  for one class at a time") — the same "one row can't represent two
  conflicting real-world facts" logic, applied to teaching assignment
  instead of tutoring. NULLs remain distinct under this constraint
  (multiple non-teaching/no-staff periods coexist freely) — live-
  verified the same way `classes_tutor_user_id_key`'s NULL-coexistence
  case already was in Module 3's first slice.

## Key design decision: no soft-delete on either table
Unlike `attendance_sessions` (which BusinessRules.md's AI section
names by domain as soft-delete-only), neither `timetable_periods` nor
`faculty_allocation` is named by that rule — schedule metadata, not
attendance/fee/marks records. Same "open question, no column yet"
treatment students/staff/classes already got: `DELETE` granted as a
placeholder, not a settled decision. Live-verified that the default FK
`RESTRICT` behavior (no `ON DELETE` specified anywhere, matching house
convention) correctly blocks deleting a `timetable_periods` row still
referenced by a `faculty_allocation` row.

## Files likely affected
- `backend/migrations/1752200000000_module-3-timetable-normalization-schema.js` (new
  — next timestamp after `1752100000000_module-4-attendance-schema.js`)
- `backend/src/repositories/timetablePeriodRepository.js` (new)
- `backend/src/repositories/facultyAllocationRepository.js` (new)

## Exact changes

**ERD — `timetable_periods`** (tenant-scoped, RLS per BusinessRules
Multi-tenancy, same pattern as every other table):
- `id` UUID PK, default gen
- `college_id` TEXT NOT NULL, FK -> `colleges(college_id)`
- `day_of_week` TEXT NOT NULL — free text, no CHECK (house convention)
- `hour_index` INT NOT NULL
- `start_time` TIME NOT NULL, `end_time` TIME NOT NULL
- `created_at`, `updated_at` TIMESTAMPTZ
- `UNIQUE (college_id, day_of_week, hour_index)`

**ERD — `faculty_allocation`**:
- `id` UUID PK, default gen
- `college_id` TEXT NOT NULL, FK -> `colleges(college_id)`
- `class_id` UUID NOT NULL, FK -> `classes(id)`
- `period_id` UUID NOT NULL, FK -> `timetable_periods(id)`
- `subject` TEXT NOT NULL
- `staff_user_id` UUID, FK -> `users(id)`, nullable
- `created_at`, `updated_at` TIMESTAMPTZ
- `UNIQUE (class_id, period_id)`, `UNIQUE (period_id, staff_user_id)`

**Migration** (`node-pg-migrate`, reversible per CLAUDE.md rule 6):
- `up`: create both tables as above (periods first, since
  `faculty_allocation.period_id` FKs into it), enable + force RLS,
  `tenant_isolation` policy on `college_id` on both (identical pattern
  to every prior table). `GRANT SELECT, INSERT, UPDATE, DELETE` to
  `arcnave_app` on both (placeholder, not the resolved soft-delete
  treatment `attendance_sessions` got).
- `down`: drop `faculty_allocation` then `timetable_periods` (FK
  order).

**Repositories** (mirror `classRepository.js`'s shape — query
mechanics only, no business logic, never call another repository per
CLAUDE.md rule 4; `facultyAllocationRepository.js` in particular never
calls `timetablePeriodRepository.js` or `classRepository.js`):
- `timetablePeriodRepository.js`: `create`, `findById`,
  `findByCollegeDayAndHour` (the natural "does this slot already
  exist" lookup, explicit `college_id` filter beyond RLS since
  uniqueness is scoped to `(college_id, day_of_week, hour_index)`,
  same reasoning as `classRepository.findByCollegeAndClassName`),
  `update`, `remove` (hard delete), `list`.
- `facultyAllocationRepository.js`: `create`, `findById`,
  `findByClassAndPeriod` (the natural single-row "who teaches this
  class this period" lookup, mirrors
  `classRepository.findByTutorUserId`'s shape), `findByClassId` (a
  class's full schedule), `findByStaffUserId` (a staff member's full
  schedule — the real, structured link a future AttendanceService
  slice needs; not consumed by anything yet, only enabled), `update`,
  `remove` (hard delete), `list`.

## Acceptance criteria
- Migration runs `up` and `down` cleanly against a DB that already has
  Module 0-4 applied; `down` reverts only these two new tables.
- RLS enabled + forced on both tables, `tenant_isolation` policy
  present, matches the established pattern exactly.
- `UNIQUE (college_id, day_of_week, hour_index)` on `timetable_periods`
  enforced with a real duplicate-insert failure.
- `UNIQUE (class_id, period_id)` on `faculty_allocation` enforced —
  proves a class cannot have two subjects in the same period.
- `UNIQUE (period_id, staff_user_id)` enforced against a genuinely
  different class (not the same class/period pair, which would hit the
  other constraint first) — proves a staff member cannot be
  double-booked across two classes at the same period; two different
  classes with `staff_user_id IS NULL` at the same period coexist
  (NULL-distinctness proof, same technique as Module 3's first slice).
- The SAME `timetable_periods` row is referenced by two different
  classes' `faculty_allocation` rows — concrete proof the "shared"
  design decision is real, not just asserted.
- FK enforcement real on `class_id`, `period_id`, and `staff_user_id` —
  each a genuine Postgres constraint violation, not guessed at.
- `findByStaffUserId` returns a real staff member's actual teaching
  schedule, live — concrete proof this is the link a future
  AttendanceService slice can use.
- FK `RESTRICT` (no `ON DELETE` override) blocks deleting a
  `timetable_periods` row still referenced by `faculty_allocation`,
  live.
- Cross-tenant RLS isolation proven through both repositories.
- No Aadhaar column anywhere. No normalized `subjects` table (out of
  scope, unchanged from Module 3's original decision).
- `classes.timetable_data` and its migration are completely untouched.
- No service, API route, UI, or `docs/modules/` file touched in this
  slice.
- Full backend test suite (203 tests) still passes — no new test file
  added (no service/API exists yet to test; live verification is
  recorded in `.ai/RESULT.md`, same as every other first-slice).
