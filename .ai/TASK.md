# TASK

## Objective
Module 3 (Academic), first vertical slice: ERD + migration + repository
only for a `classes` table — no service/API/UI yet. Same discipline as
Module 1's first slice (`fbfd1c9`) and Module 2's first slice
(`31f5a8b`): a class/section entity was explicitly deferred to this
module by name in both the Staff migration and BusinessRules.md.

## Grounding (read before assuming any field list)
No `ClassEditorModal.jsx`/admin "create class" screen exists — classes
are grounded against the three frontend files that already read/write
class + timetable data as working (non-404ing shape), not a form that
creates them:

- `frontend/src/pages/HodDashboard.jsx` — `classesList` (from
  `GET /api/hod/classes`), each entry carries `class_name` (e.g.
  `"3rd Sem · CS-A"`), `tutor_id`, `semester`. The tutor-link flow
  (`staffForm.linked_semester` -> `POST /api/hod/link-tutor` with body
  `{ tutor_id, semester, ... }`) identifies a class by `semester`, not
  by any id — confirming `semester` is a real, distinct field, not
  just a substring of `class_name`. Timetable review
  (`handleTimetableReview` -> `POST /api/hod/timetable-review`, body
  `{ tutor_id, action, remarks }`) actions are `'Approve'` (direct),
  `'Forward'` (-> Principal), `'Reject'`.
- `frontend/src/pages/PrincipalDashboard.jsx` — same `pendingTimetables`
  shape (`class_name`, `tutor_id`, `submitted_at`), same review action
  set restricted to `'Approve'`/`'Reject'` (Principal is a final gate,
  no further forwarding).
- `frontend/src/pages/TutorClass.jsx` / `TutorClassMonitor.jsx` — the
  actual per-class settings object: `timetable_status` (literal
  strings seen: `'No Tutor'`, `'Pending HOD'`, `'Pending Principal'`,
  `'Approved'`, `'Rejected'`), `timetable_data` (`{ headers: [...],
  rows: [...] }` — a free-text day/hour grid, e.g. a cell reads
  `"Data Structures (Priya)"`; subjects and staff names live as text
  *inside* the grid, there is no normalized subjects/faculty-allocation
  table backing it anywhere in the working frontend), `timetable_path`
  (uploaded CSV reference), `timetable_remarks` (populated on
  rejection).

This confirms Architecture.md's list ("academic year, semester,
subjects, curriculum, faculty allocation, timetable, calendar") is the
long-run shape of the whole module, not what the first working screen
actually needs — matching Module 1/2's own "first slice is one table"
discipline, not an attempt to build all of Module 3 at once.

## Key design decision: one `classes` table, not a normalized subject/timetable-period schema yet
The real, working frontend never queries a separate `subjects` table
or a per-period faculty-allocation record — timetable content is an
opaque CSV-derived grid (`headers`/`rows`) attached to a class. Building
a normalized subjects/periods/faculty-allocation schema now would be
structure nobody asked for yet (CLAUDE.md discipline, the same call
Module 2's `.ai/TASK.md` made against inventing a `departments` table).
This slice models exactly what's grounded: a `classes` row per
class/section, carrying its own timetable review state and the parsed
grid as JSONB. Normalizing subjects/periods out of that JSONB blob is
explicitly left to a later Module 3 slice, if/when a real screen needs
to query by subject or by faculty allocation rather than just
displaying the grid.

## Key design decision: no `timetable_path` column in this slice
The frontend's `timetable_path` is a reference to an uploaded CSV file.
CLAUDE.md rule 2 / Architecture.md 2.5: `DocumentService` is the sole
owner of all file storage, and it doesn't exist yet (Module 6). Adding
a raw file-path column here would let `classes`/`AcademicService`
quietly become a second file-storage owner — the same trap flagged and
avoided for Class Tutor in the Module 2 migration. `timetable_data`
(the already-parsed JSON grid) is in scope; the raw uploaded file is
not — flagged as an open gap for whichever slice wires up real CSV
upload (Academic, calling into `DocumentService` once it exists), not
decided or silently dropped here.

## Key design decision: `tutor_user_id` references `users(id)`, not `staff(id)`
BusinessRules.md's "Resolved (Module 2 kickoff)" entry already settled
this: "a class/section record carries a tutor reference (a faculty
user_id) instead" — not a `staff.id` FK. `staffRepository.js`'s own
top-of-file comment names this exact table as deferred to Module 3.
Followed verbatim, not re-litigated here.

## Files likely affected
- `backend/migrations/1752000000000_module-3-academic-schema.js` (new
  — next timestamp after `1751900000000_module-2-staff-schema.js`)
- `backend/src/repositories/classRepository.js` (new)

## Exact changes

**ERD — `classes` table** (tenant-scoped, RLS per BusinessRules
Multi-tenancy, same pattern as `students`/`staff`):

- `id` UUID PK, default gen
- `college_id` TEXT NOT NULL, FK -> `colleges(college_id)`
- `class_name` TEXT NOT NULL — free-text display label (e.g. `"3rd Sem
  · CS-A"`), same "free-text class name" precedent BusinessRules.md
  already documents for Attendance/Students ("only free-text class
  names... exist").
- `department` TEXT — freeform, no `departments` table, same decision
  Module 2 made for `staff.department` and for the same reason
  (nothing today needs it as a normalized entity).
- `semester` TEXT — free text (`'3rd Sem'`, etc., not an integer),
  matches the real `linked_semester` values used at the
  `/api/hod/link-tutor` boundary.
- `tutor_user_id` UUID, FK -> `users(id)`, nullable (a class starts
  with no tutor assigned — `'No Tutor'` status). `UNIQUE
  (tutor_user_id)` enforces BusinessRules' "Class Tutor is assigned
  only by HOD, for one class at a time" at the DB level — multiple
  NULLs (untutored classes) remain valid since Postgres treats NULLs
  as distinct in a UNIQUE constraint.
- `timetable_status` TEXT NOT NULL DEFAULT `'No Tutor'` — no CHECK
  constraint, matching house convention (`users.role`,
  `colleges.subscription_status` also have no DB-level CHECK on their
  known value sets); known real values documented here in comments
  instead: `'No Tutor'`, `'Pending HOD'`, `'Pending Principal'`,
  `'Approved'`, `'Rejected'`. `'Approved'` is the literal gate value
  CLAUDE.md rule 7 and BusinessRules.md's Academic section reference
  for unlocking Attendance.
- `timetable_data` JSONB — nullable (`{ headers: [...], rows: [...] }`
  grid), matches the real frontend shape exactly.
- `timetable_remarks` TEXT — nullable, populated on rejection.
- `created_at`, `updated_at` TIMESTAMPTZ

No Aadhaar column (CLAUDE.md rule 8 — not that this table would ever
plausibly need one, keeping the same explicit-absence discipline
regardless). No `subjects`/`faculty_allocation`/`timetable_periods`
tables yet — deferred per the design decision above, not an oversight.

**Migration** (`node-pg-migrate`, reversible per CLAUDE.md rule 6):
- `up`: create `classes` as above, enable + force RLS, tenant_isolation
  policy on `college_id` (identical pattern to Module 1/2's
  migrations — not reinvented), `UNIQUE (college_id, class_name)`,
  `UNIQUE (tutor_user_id)`. Placeholder `GRANT SELECT, INSERT, UPDATE,
  DELETE` to `arcnave_app` — same "no soft-delete field decided yet"
  treatment `students`/`staff`/`configurations` already got.
- `down`: drop table.

**Repository** (`classRepository.js`, mirrors `staffRepository.js`'s
shape — query mechanics only, no business logic, never calls another
repository per CLAUDE.md rule 4):
- `create(client, fields)`
- `findById(client, id)`
- `findByTutorUserId(client, tutorUserId)` — the natural lookup for
  "which class does this logged-in tutor own" (same role
  `findByUserId` plays for staff), no explicit `college_id` filter
  beyond RLS since `tutor_user_id` is globally unique (`UNIQUE
  (tutor_user_id)`), same reasoning `staffRepository.findByUserId`
  documents for its own `UNIQUE (user_id)` column.
- `findByCollegeAndClassName(client, collegeId, className)` — secondary
  human-facing lookup, explicit `college_id` filter in addition to RLS
  since `class_name` is only unique per `(college_id, class_name)`,
  same pattern as `findByStaffCode`/`findByRollNo`.
- `update(client, id, fields)` (partial, same entries-filter pattern as
  `staffRepository.update`)
- `remove(client, id)` (hard delete — no soft-delete column exists,
  same placeholder treatment as `students`/`staff`)
- `list(client, { limit, offset })`

## Acceptance criteria
- Migration runs `up` and `down` cleanly against a DB that already has
  Module 0/1/2 (`users`/`colleges`/`students`/`staff`) applied.
- RLS enabled + forced, `tenant_isolation` policy present, matches the
  `students`/`staff` pattern exactly.
- `UNIQUE(college_id, class_name)` and `UNIQUE(tutor_user_id)` both
  enforced at the DB level — prove with a real duplicate-insert
  failure for each, not just by reading the DDL.
- Inserting a `classes` row with a `tutor_user_id` that doesn't exist
  in `users` fails on the FK constraint.
- Two classes with `tutor_user_id IS NULL` can coexist (proves NULLs
  aren't caught by the UNIQUE constraint) — concrete proof the
  "class starts with no tutor" default state is representable.
- No Aadhaar column anywhere. No `timetable_path`/file-storage column
  anywhere (this slice's scope boundary, see design decision above).
- Repository has zero references to Storage, other repositories, or
  business-service logic.
- No service, API route, UI, or `docs/architecture/ERD.md` /
  `docs/modules/` file touched in this slice — matches `fbfd1c9`'s and
  `31f5a8b`'s actual scope (both `RESULT.md`s changed only the
  migration + repository files, nothing docs-side), not the broader
  "ERD" wording in the vertical-slice list taken literally as a doc
  edit.
