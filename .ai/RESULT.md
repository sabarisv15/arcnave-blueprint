# RESULT

## Files changed
- backend/migrations/1751900000000_module-2-staff-schema.js (new)
- backend/src/repositories/staffRepository.js (new)

## What changed, per file
- `1751900000000_module-2-staff-schema.js`: creates `staff` — `id`,
  `college_id` (FK -> `colleges`), `user_id` (FK -> `users`, `UNIQUE`
  — 1:1 with a login account), `staff_code` (freeform HR/biometric
  code, deliberately not named `staff_id` — see `.ai/TASK.md`),
  `full_name`, `gender`, `dob`, `phone`, `department`, `designation`,
  `qualification`, `has_phd`, `aicte_id`, `joined_year`, `address`,
  `created_at`/`updated_at`. RLS enabled + forced with a
  `tenant_isolation` policy on `college_id`, identical pattern to
  Module 0/`students`. `UNIQUE (user_id)` and
  `UNIQUE (college_id, staff_code)`. No Aadhaar column, no Class Tutor
  column (both deliberate — see `.ai/TASK.md`). `down` drops the
  table.
- `staffRepository.js`: `create`, `findById`, `findByUserId`,
  `findByStaffCode`, `update` (partial), `remove`, `list` (paginated)
  — mirrors `studentRepository.js`'s shape exactly. Raw SQL confined
  to this file, no calls to other repositories, no business
  logic/validation beyond what Postgres itself enforces.

## Tests
No Docker in this environment (confirmed: `docker` is not installed
and there is no root/sudo to install it — a real constraint of this
sandbox, not skipped by choice). Substituted a real, live Postgres
instead of a throwaway container: the `embedded-postgres` npm package
(downloads real upstream PostgreSQL 18.4 server binaries, no root
required), run standalone on port 5433, database/roles bootstrapped
by hand to match `docker/postgres/init/` (`arcnave_admin` superuser =
migration role, `arcnave_app`/`arcnave_platform` = least-privilege
runtime roles) — same three-role separation as the real stack, just a
different way of getting a live Postgres process in this sandbox.
Removed after (`/tmp` scratch data dir, discarded).

All 5 migrations were run in sequence through node-pg-migrate's
programmatic API (same `runner()` `backend/scripts/migrate.js` uses),
then `staff` was verified directly, then reverted, then re-applied —
all against one live database, no mocks:

1. **`up` (all 5 migrations, including this one)** — PASS. Ran
   cleanly end to end against a fresh database.
2. **RLS enabled + forced, policy present** — PASS.
   `pg_class.relrowsecurity`/`relforcerowsecurity` both `true`;
   `pg_policy` shows exactly one policy, `tenant_isolation`, with
   `col­lege_id = current_setting('app.current_tenant'::text, true)` —
   byte-for-byte the same predicate `students` uses.
3. **No Aadhaar column** — PASS. `information_schema.columns` lists
   all 17 expected columns, no `aadhaar*` anywhere.
4. **FK enforcement (`staff.user_id -> users.id`)** — PASS. Inserting
   a `staff` row with a random, non-existent `user_id` raised
   `violates foreign key constraint "staff_user_id_fkey"`. This is the
   concrete DB-level enforcement of this slice's scope decision (no
   staff profile without a real, already-provisioned account).
5. **`UNIQUE (user_id)`** — PASS. Seeded a real `users` row, inserted
   one `staff` row for it (succeeded), then a second `staff` row for
   the *same* `user_id` — raised
   `violates unique constraint "staff_user_id_key"`.
6. **`UNIQUE (college_id, staff_code)`** — PASS, both directions.
   Inserting a second staff row in the *same* college with the *same*
   `staff_code` failed with
   `violates unique constraint "staff_college_id_staff_code_key"`;
   inserting that same `staff_code` under a *different* college
   succeeded — proving the uniqueness is genuinely per-tenant, not
   global.
7. **Repository exercised live, through the real `arcnave_app` role,
   with real tenant context** — not just `node --check`. Opened a
   transaction, ran `SET LOCAL app.current_tenant = 'COLA'` (exactly
   what Tenant Middleware does on a real request), then called every
   exported function from `staffRepository.js` against the live DB
   through that connection:
   - `list()` returned exactly the one row belonging to tenant COLA
     (not COLB's row, which exists in the same table) — PASS.
   - `findByUserId()` found the seeded row — PASS.
   - `findByStaffCode('COLA', 'CSE-01')` found the same row — PASS.
   - `update(id, { designation: 'Associate Professor' })` applied a
     partial update and returned the changed row — PASS.
   - `create({ collegeId, userId, fullName, hasPhd: true })` with
     `staffCode` omitted inserted successfully with `staff_code =
     NULL` (Postgres's own default/no-value handling, not an explicit
     NULL fighting a NOT NULL constraint) — PASS, proves the same
     entries-filtering discipline `studentRepository.create` uses was
     copied correctly, not just visually similar.
   - `remove(id)` deleted the row; a follow-up `findById` returned
     `null` — PASS.
   - Switched tenant context to `SET LOCAL app.current_tenant =
     'COLB'` in a fresh transaction and called `list()` again: got
     back only COLB's own row (different `id` than COLA's row) — PASS,
     direct proof RLS is doing real cross-tenant isolation through
     this repository, not just through raw SQL run as a superuser.
8. **`down` reverts only `staff`, leaves everything else intact** —
   PASS. Ran node-pg-migrate's `down` with `count: 1` (not
   `scripts/migrate.js`'s hardcoded `count: Infinity`, which would
   have reverted every migration — used the programmatic API directly
   with an explicit count instead, same reasoning as the marks-to-text
   fix's file-isolation trick, different mechanism). `to_regclass
   ('public.staff')` → `null`; `to_regclass('public.students')` still
   resolved — Module 0/1 tables untouched; `pgmigrations` dropped back
   to exactly the 4 prior migrations.
9. **Re-applied `up`, final state** — PASS. `staff` exists again,
   empty (0 rows — the drop/recreate cycle, not leftover fixture
   data).
10. `node --check` on both new files — PASS, no syntax errors.

## Flags / open questions
- **No Docker in this sandbox** — verified against a real, live
  Postgres 18.4 server instead (see Tests), not a mock or in-memory
  substitute. Functionally equivalent to the container-based
  verification prior slices used, but flagging the mechanism change
  since it's a real environment difference, not something to gloss
  over.
- **Did not re-run the full existing backend suite
  (`node --test tests/`)** — unlike the Module 1 fix, which touched
  columns three other files depend on and needed a full-suite
  regression check. This slice adds one wholly new, isolated table
  with no foreign keys pointing *into* it from any existing code and
  no existing file modified — the blast radius is genuinely zero for
  every other module. Given the 45-second-per-command constraint in
  this sandbox (no persistent background process across tool calls,
  everything — server boot, all migrations, every check, teardown —
  had to fit in one shot), running the full suite (which boots a real
  HTTP server per test file) was judged not worth the risk of an
  artificial timeout corrupting a otherwise-clean verification run.
  If this reasoning is wrong, re-running `npm test` against a real
  Postgres is a cheap follow-up, not a structural gap.
- **The pending self-registration state is still nowhere** — as
  flagged in `.ai/TASK.md`: `FacultyRegister.jsx`'s "submit, wait for
  HOD/Principal approval" flow has no backing table yet. Not decided
  here on purpose; revisit when `StaffService`/Module 8 actually needs
  it.
- **Sandbox file-sync note, not a code issue**: while working in this
  session, direct writes to `.ai/TASK.md`/`.ai/RESULT.md` through the
  file-editing tool were, on inspection, landing truncated/corrupted
  when read back from the shell's mount of this folder (confirmed via
  a byte-level check — NUL-padding and mid-word truncation, not a
  real edit). Wrote both files directly through the shell instead
  (which does not show this issue) to get a verified-correct copy
  before running `git status`/`diff`/`add`/`commit` — matters here
  specifically because `git` runs in the shell, and it needed to be
  looking at real content, not a lagged/corrupted snapshot. Neither
  new code file was affected (checked the same way — clean). Also
  noticed several *other*, unrelated files already showing as modified
  in `git status` (`backend/src/tenantApp.js`, `frontend/src/App.jsx`,
  `frontend/src/components/StudentEditorModal.jsx`,
  `frontend/src/pages/Login.jsx`, `docs/architecture/BusinessRules.md`)
  before this session touched anything — left those alone entirely
  (`git add` was scoped to exactly the 4 files this slice changed, not
  `-A`), since diagnosing whether those are real pending edits or the
  same sync artifact is outside this task's scope. Worth a human
  double-check before anyone runs a blanket `git add -A` in this repo.
