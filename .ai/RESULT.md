# RESULT

## Files changed
- backend/migrations/1751700000000_module-1-student-schema.js (new)
- backend/src/repositories/studentRepository.js (new)

## What changed, per file
- `1751700000000_module-1-student-schema.js`: creates `students` with every
  ERD column from `.ai/TASK.md` (no Aadhaar column). RLS enabled + forced with
  a `tenant_isolation` policy on `college_id`, matching Module 0's
  `current_setting('app.current_tenant', true)` pattern exactly.
  `UNIQUE (college_id, roll_no)`. `down` drops the table.
- `studentRepository.js`: `create`, `findById`, `findByRollNo`, `update`
  (partial), `remove`, `list` (paginated). Raw SQL confined to this file, no
  calls to other repositories, no business logic/validation beyond what
  Postgres itself enforces (per StudentService owning that, not this slice).

## Tests
Ran against a throwaway `postgres:16` Docker container (`arcnave_admin`/
`arcnave_app`/`arcnave_platform` roles created manually, matching
`docker/postgres/init/`), migrated through `1751500000000` and
`1751600000000` first via `node-pg-migrate`. Container removed after.

1. **`up`** — PASS. `students` created; `psql \d students` confirms
   `relrowsecurity`/`relforcerowsecurity` both `t`; `pg_policy` shows
   `tenant_isolation` with
   `(college_id = current_setting('app.current_tenant', true))`;
   `UNIQUE (college_id, roll_no)` confirmed live — inserting a duplicate
   `(col1, R001)` raised `duplicate key value violates unique constraint
   "students_college_id_roll_no_key"`, while `(col2, R001)` (different
   college, same roll_no) inserted fine.
2. **`down`** — PASS. `to_regclass('public.students')` → null,
   `pg_policies` has zero rows for `students`, `\dt` shows Module 0 /
   principal_invitations tables untouched, `pgmigrations` back to just
   those two rows.
3. **`node --check backend/src/repositories/studentRepository.js`** — PASS
   (re-ran after the `pool`→`client` edit; the earlier stale-mount issue
   is gone).
4. **Aadhaar column** — PASS. `information_schema.columns` for `students`
   lists all 28 expected columns, no `aadhaar*` anywhere.

## Review pass (second look against authRepository.js/configurationRepository.js conventions)
- `create`'s first param renamed `pool` → `client`: students is a plain
  RLS-scoped tenant table (like `users`), not a platform-side table, so it
  should always be called with the request's tenant-scoped connection, same
  as `authRepository.js`'s `createUser`. `pool` implied the wrong connection
  type.
- `findByRollNo` now takes `collegeId` and filters `WHERE college_id = $1
  AND roll_no = $2`, not just `roll_no`. `roll_no` is only unique per
  `(college_id, roll_no)`, not globally — same situation as
  `authRepository.js`'s `getUserByUsername`, which filters on `collegeId`
  explicitly for the same reason. RLS would still have scoped the result
  correctly, but the explicit filter matches house convention for
  non-globally-unique lookups and documents the real key.

## Flags / open questions
- **File name**: used `studentRepository.js` (camelCase) instead of the
  task's `StudentRepository.js` — every existing repository in
  `backend/src/repositories/` is camelCase; matched that convention.
- **Uniqueness field**: used `roll_no` for `(college_id, roll_no)`, per the
  task's own flagged assumption — `register_no`/`admission_no` aren't in the
  documented field list.
- **Soft delete**: no soft-delete column exists in the given ERD, so
  `remove()` is a hard `DELETE`. Same placeholder-grant treatment
  `configurations` got in the Module 0 migration.
