# RESULT

## Files changed
- backend/migrations/1752000000000_module-3-academic-schema.js (new)
- backend/src/repositories/classRepository.js (new)

## What changed, per file
- `1752000000000_module-3-academic-schema.js`: creates `classes` —
  `id`, `college_id` (FK -> `colleges`), `class_name`, `department`,
  `semester` (all free text — no `departments` table, no integer
  semester), `tutor_user_id` (FK -> `users`, nullable, `UNIQUE`),
  `timetable_status` (TEXT, default `'No Tutor'`, no CHECK constraint
  — matches house convention, known real values documented in
  comments only), `timetable_data` (JSONB, nullable — `{headers,
  rows}` grid), `timetable_remarks`, `created_at`/`updated_at`. RLS
  enabled + forced with a `tenant_isolation` policy on `college_id`,
  identical pattern to Module 0/1/2. `UNIQUE (college_id, class_name)`
  and `UNIQUE (tutor_user_id)`. No Aadhaar column, no
  `timetable_path`/file-storage column, no `subjects`/
  `faculty_allocation`/`timetable_periods` tables (all deliberate —
  see `.ai/TASK.md`). `down` drops the table.
- `classRepository.js`: `create`, `findById`, `findByTutorUserId`,
  `findByCollegeAndClassName`, `update` (partial), `remove`, `list`
  (paginated) — mirrors `staffRepository.js`'s shape exactly. Raw SQL
  confined to this file, no calls to other repositories, no business
  logic/validation beyond what Postgres itself enforces.

## Tests
Same sandbox constraint Module 2 hit: no Docker, no root
(`apt-get`/`sudo` both confirmed unusable — `dpkg` lock requires root,
`sudo` is blocked by a "no new privileges" flag). Used
`embedded-postgres` (real upstream PostgreSQL 18.4 binaries, no root
required) exactly like Module 2's slice did, run standalone on port
54329 in a scratch directory, roles bootstrapped by hand to match
`docker/postgres/init/` (`arcnave_admin` = migration-owner superuser,
`arcnave_app`/`arcnave_platform` = least-privilege runtime roles).
Removed after (scratch data dir + throwaway `node_modules`, discarded
— nothing from this harness is part of the repo).

Getting there took real troubleshooting, worth recording since it'll
recur for future slices in this same sandbox:
- The downloaded `@embedded-postgres/linux-x64` package's own
  `native/pg-symlinks.json` manifest — which is supposed to
  regenerate the shared-library symlinks NPM tarballs can't preserve
  (e.g. `libicuuc.so.60 -> libicuuc.so.60.2`) and restore several
  `share/postgresql/*.sample` config templates — landed **0 bytes**
  after `npm install`, and several `share/postgresql/` files were
  missing outright. Diffing against a freshly-`npm pack`'d copy of
  the exact same package version confirmed the real manifest is 1100
  bytes with real content and the real tarball does contain the
  missing `.sample` files — this was the same
  write-truncation-on-this-mount issue flagged below, hitting `npm
  install`'s output, not a real upstream packaging bug. Fixed by
  extracting a freshly-downloaded copy of the identical version and
  copying the missing files over, then re-running the package's own
  `hydrate-symlinks.js`.
- `initdb` itself failed with `could not remove old lock file /
  Operation not permitted` when its scratch data directory lived under
  the mounted `outputs` folder — a leftover data directory from an
  earlier attempt could not be deleted through that mount (matches the
  session's earlier `.git/index.lock` deletion problem — the same
  mount enforces a "cannot unlink" restriction on some paths/timings,
  not specific to git). Fixed by moving the entire scratch harness
  (`node_modules` + data dir) onto a path outside any mounted folder
  before running `initdb`/`pg_ctl` — deletions there behave normally.

With those two fixed, everything else ran clean, against one live
database, no mocks, in this order:

1. **`up` (all 6 migrations, including this one)** — PASS. Ran
   cleanly end to end against a fresh database (after also creating
   the `arcnave_platform` role Module 0's migration grants against,
   which this from-scratch harness hadn't created on the first
   attempt).
2. **RLS enabled + forced, policy present** — PASS, same
   `tenant_isolation` predicate pattern as `students`/`staff`.
3. **No Aadhaar column, no `timetable_path` column** — PASS (both
   scope decisions from `.ai/TASK.md`, confirmed by inspecting the
   live schema, not just re-reading the migration file).
4. **`UNIQUE (tutor_user_id)`** — PASS, proven twice: (a) assigning
   the same real `tutor_user_id` to a second class raised
   `duplicate key value violates unique constraint
   "classes_tutor_user_id_key"`; (b) two separate classes both with
   `tutor_user_id IS NULL` coexisted without error — proves the "class
   starts with no tutor" default state is genuinely representable,
   not accidentally blocked by the same constraint.
5. **`UNIQUE (college_id, class_name)`** — PASS. A second insert
   reusing an existing `(college_id, class_name)` pair in the same
   tenant raised `duplicate key value violates unique constraint
   "classes_college_id_class_name_key"`.
6. **FK enforcement (`classes.tutor_user_id -> users.id`)** — PASS.
   Inserting a `classes` row with a random, non-existent
   `tutor_user_id` raised `violates foreign key constraint
   "classes_tutor_user_id_fkey"` — concrete DB-level enforcement that
   a class can only be tutored by a real account.
7. **`timetable_data` JSONB round-trip** — PASS. Wrote a real
   `{headers, rows}` grid (the exact shape `TutorClass.jsx`/
   `TutorClassMonitor.jsx` use) through `update()`, read it back,
   confirmed both `headers` and `rows` matched byte-for-byte (Postgres
   reorders JSONB object keys on storage, so the check compares
   `headers`/`rows` values directly rather than a raw
   `JSON.stringify` of the whole object — a verification-script
   detail, not a schema concern).
8. **Repository exercised live, through the real `arcnave_app` role,
   with real tenant context** — every exported function from
   `classRepository.js` called against the live DB inside a real
   `SET LOCAL app.current_tenant = '<college>'` transaction (exactly
   what Tenant Middleware does on a real request):
   - `create()` with only `collegeId`/`className`/`department`/
     `semester` supplied left `tutor_user_id` `NULL` and
     `timetable_status` at its `'No Tutor'` DEFAULT — PASS, proves the
     same entries-filtering discipline `staffRepository.create` uses
     was copied correctly.
   - `update(id, { tutorUserId, timetableStatus: 'Pending HOD' })`
     applied a partial update and returned the changed row — PASS.
   - `findByTutorUserId()` found the class just assigned — PASS.
   - `findByCollegeAndClassName()` found the right row by its
     per-tenant natural key — PASS.
   - `remove(id)` deleted a row; a follow-up `findById` returned
     `null` — PASS.
9. **Cross-tenant RLS isolation** — PASS, the release-gate check
   Architecture.md requires: seeded a second tenant (`TENANTB`) with
   its own class, then, scoped to `TENANTB`'s tenant context, called
   `findById()` on `TENANTA`'s class directly by primary key (got
   `null`, not the row) and `list()` (got back exactly `TENANTB`'s one
   row, never `TENANTA`'s two) — direct proof RLS blocks cross-tenant
   reads through this repository, not just through raw SQL run as a
   superuser.
10. **`down` reverts only `classes`, leaves everything else intact**
    — PASS. Ran node-pg-migrate's `down` with an explicit `count: 1`
    (same technique Module 2's slice used, not `scripts/migrate.js`'s
    hardcoded `count: Infinity`, which would have reverted every
    migration). `to_regclass('public.classes')` → `null`;
    `to_regclass('public.staff')` and `to_regclass('public.students')`
    both still resolved — Module 0/1/2 tables untouched.
11. **Re-applied `up`, final state** — PASS. `classes` exists again,
    empty.
12. `node --check` on both new files — PASS, no syntax errors.

## Flags / open questions
- **No Docker in this sandbox** — same situation Module 2 documented;
  verified against a real, live Postgres 18.4 server instead (see
  Tests), not a mock.
- **No `subjects`/`faculty_allocation`/`timetable_periods` tables
  yet** — deliberate scope boundary for this first slice (see
  `.ai/TASK.md`'s design-decision section): the real, working frontend
  never queries a normalized subjects/periods table, only an opaque
  CSV-derived grid. Revisit in a later Module 3 slice if/when a real
  screen needs to query by subject or faculty allocation rather than
  just display the grid.
- **No `timetable_path` (uploaded file) column** — deliberate:
  `DocumentService` (Module 6) is the sole owner of file storage per
  CLAUDE.md rule 2, and doesn't exist yet. Only the already-parsed
  `timetable_data` JSONB is in scope. Whichever future slice wires up
  real CSV upload needs to call into `DocumentService` once it
  exists, not add a raw path column here.
- **`timetable_status` has no DB-level CHECK constraint** — matches
  house convention (`users.role`/`colleges.subscription_status` also
  have none); the known real value set (`'No Tutor'`, `'Pending HOD'`,
  `'Pending Principal'`, `'Approved'`, `'Rejected'`) is documented in
  the migration's comments and will need real enforcement once
  `AcademicService` (a later slice) owns the review-workflow
  transitions (`'Pending HOD'` -> `'Approved'`/`'Pending
  Principal'`/`'Rejected'`, etc., per `HodDashboard.jsx`/
  `PrincipalDashboard.jsx`'s real `handleTimetableReview` actions).
- **No service, API route, UI, or `docs/architecture/ERD.md`/
  `docs/modules/` file touched in this slice** — matches Module 1's
  and Module 2's actual first-slice scope exactly (both prior
  `RESULT.md`s changed only the migration + repository files).
- **Sandbox file-write/delete quirk, not a code issue, recurring
  across sessions**: at the *start* of this session, nine files in the
  working tree (`.ai/RESULT.md`, `.ai/TASK.md`, `backend/src/
  tenantApp.js`, `docs/architecture/BusinessRules.md`, `frontend/src/
  App.jsx`, `frontend/src/components/StudentEditorModal.jsx`,
  `frontend/src/pages/HodDashboard.jsx`, `frontend/src/pages/
  Login.jsx`, `frontend/src/pages/PrincipalDashboard.jsx`) were found
  truncated/NUL-padded on disk relative to `HEAD` (`49c2c36`) — the
  same class of corruption Module 2's `RESULT.md` already flagged for
  a subset of these files, confirming it's a persistent environment
  quirk, not something either session did. Restored all nine via
  `git show HEAD:<path>` piped straight to the file (bypassing a
  simultaneously-stuck `.git/index.lock` that `git checkout` couldn't
  clear — resolved after the user closed whatever process on their
  end had a handle open on it). This session's own file-editing tool
  also produced a truncated write again mid-session (a scratch
  verification script in the temporary outputs folder, cut off
  mid-statement); writing through the shell directly instead (as
  Module 2's session also ended up doing) produced a correct copy
  every time. `.ai/TASK.md`/`.ai/RESULT.md` for *this* slice were
  both written through the shell for that reason, then confirmed
  correct via `git diff`/`wc -l` before this commit.
