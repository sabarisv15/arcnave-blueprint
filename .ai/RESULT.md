# RESULT

## Files changed
- backend/src/services/staffService.js (new)
- backend/tests/staff-service.test.js (new)

## What changed, per file
- `staffService.js`: `createStaff`, `getStaff`, `updateStaff`,
  `removeStaff`, `listStaff`. Four domain errors —
  `StaffValidationError` (missing `userId`/`fullName`),
  `StaffUserConflictError` (`23505` on `staff_user_id_key`),
  `StaffCodeConflictError` (`23505` on
  `staff_college_id_staff_code_key`), `StaffUserNotFoundError` (`23503`
  on `staff_user_id_fkey`) — no raw pg error ever reaches the caller.
  The two `23505` cases are distinguished via `err.constraint`, not
  `err.message` parsing (see `.ai/TASK.md` for why this deliberately
  departs from `platformService.js`'s single `DuplicateCollegeError`
  for `colleges`' two constraints — staff's two constraints mean
  different things to a caller). `ALLOWED_FIELDS` whitelist mirrors
  but deliberately duplicates `staffRepository.js`'s column list
  (same as `studentService.js`'s `ALLOWED_FIELDS`); `collegeId`/
  `userId` excluded from what `updateStaff` accepts (set once at
  creation, never moved via update). `staffCode` is not a required
  field on create (unlike `students.roll_no`) — `staff.staff_code` is
  nullable. Calls only `staffRepository` and `auditLogRepository` — no
  other repository, no Storage, no `WorkflowService`. No RBAC/
  authorization logic (left to the future route/RBAC layer, per the
  task).
- `staff-service.test.js`: 15 unit tests (14 subtests + 1 wrapper) for
  every path that needs no DB — missing-`userId`/missing-`fullName`
  validation, aadhaar-drop, `staffCode`-not-required, all three
  hand-thrown `err.code`+`err.constraint` -> domain-error mappings
  (`staff_user_id_key` -> `StaffUserConflictError`,
  `staff_college_id_staff_code_key` -> `StaffCodeConflictError`,
  `staff_user_id_fkey` -> `StaffUserNotFoundError`), a non-conflict
  error passing through unchanged, the "audit entry only if a row
  actually changed" logic for `updateStaff`/`removeStaff` (including
  a `staff_code` conflict surfacing correctly from the update path
  too), and `removeStaff`'s found/not-found audit behavior.
  `staffRepository`/`auditLogRepository` stubbed via `node:test`'s
  built-in `t.mock.method`, same pattern as `student-service.test.js`.

## Tests
1. **Unit (no DB)** — `node --test tests/staff-service.test.js`:
   15/15 pass (`# pass 15`, `# fail 0`).
2. **Live, against the real docker-compose Postgres** (not
   embedded-postgres — Docker is available in this environment; the
   `db` service from `docker-compose.yml` was brought up directly with
   `docker compose up -d db`, real `postgres:16`, port 5432). Wrote a
   throwaway script that called `staffService.js` itself (not a copy,
   not a stub) through the real `arcnave_app` role with
   `set_config('app.current_tenant', ...)` set per transaction — the
   same tenant-context pattern Tenant Middleware uses on a real
   request. Seeded three spare `users` rows for this via the
   `arcnave_admin` superuser role (bypasses RLS), ran every path, then
   deleted every row this script touched (`audit_log` first, then
   `staff`, then `users`, respecting FK order) — confirmed empty
   afterward via direct count queries. Script itself removed after
   (not committed).
   - `createStaff` missing `userId` -> `StaffValidationError` — PASS.
   - `createStaff` happy path, `staffCode` omitted -> inserted with
     `staff_code = NULL` (Postgres default handling, not a NOT NULL
     violation) — PASS.
   - `staff_created` audit_log row present after create — PASS.
   - `createStaff` on a real duplicate `user_id` -> genuine Postgres
     `23505` on `staff_user_id_key` -> `StaffUserConflictError` — PASS.
   - `createStaff` on a real duplicate `(college_id, staff_code)` ->
     genuine `23505` on `staff_college_id_staff_code_key` ->
     `StaffCodeConflictError` — PASS, and distinguishable from the
     `user_id` conflict above (different error class, same code path).
   - `createStaff` with a `userId` that doesn't exist in `users` ->
     genuine `23503` on `staff_user_id_fkey` ->
     `StaffUserNotFoundError` — PASS.
   - `updateStaff` changing `staffCode` to one already taken in the
     same college -> genuine `23505` on
     `staff_college_id_staff_code_key` -> `StaffCodeConflictError` on
     the update path too — PASS (confirms the mapping isn't only
     wired for create).
   - `updateStaff` with a recognized field -> row updated, exactly one
     `staff_updated` audit_log row — PASS.
   - `removeStaff` on an existing row -> deleted, `getStaff` returns
     `null` afterward, exactly one `staff_removed` audit_log row —
     PASS.
   - `removeStaff` on an already-removed id -> no-op, no second
     `remove`/audit call — PASS.
3. `node --check` on both new files — PASS, no syntax errors.

## Flags / open questions
- **Conflict-type split (`StaffUserConflictError` vs.
  `StaffCodeConflictError`) is a deliberate deviation from
  `platformService.js`'s precedent** of bundling `colleges`' two
  `UNIQUE` constraints into one `DuplicateCollegeError` — reasoning
  captured in `.ai/TASK.md`. Flagging again here in case the project
  would rather stay consistent with the bundling precedent even though
  the two staff failures mean different things to a caller.
- **`err.constraint` reliance** — this slice's constraint-name
  branching depends on node-postgres continuing to populate
  `err.constraint` on `23505`/`23503` (live-verified this session, not
  assumed from docs). If a future `pg` upgrade ever stopped populating
  it, the `if` branches would silently fall through to the generic
  `throw err` rather than mis-mapping to the wrong domain error — a
  safe failure mode, not a silent one, but noting the dependency
  explicitly.
- **Audit-logging on writes is still an assumption, not a confirmed
  requirement** — same carried-forward flag as `studentService.js`'s
  `RESULT.md`: BusinessRules.md doesn't explicitly mandate an audit
  entry for staff create/update/remove; this follows the existing
  house convention, not a stated rule.
- **`staffCode` intentionally not required** — contrast with
  `students.roll_no` flagged in `.ai/TASK.md` and re-flagged here
  since it's the one place this slice's validation genuinely differs
  in shape from its template, not just in naming.
- **Soft delete still unresolved** — `removeStaff` is still a hard
  `DELETE` (via `staffRepository.remove`), unchanged open question
  carried forward from the first slice.
- **The pending self-registration state is still nowhere** — unchanged
  from the first slice's flag: `FacultyRegister.jsx`'s "submit, wait
  for HOD/Principal approval" flow has no backing table or service
  path yet. Not decided here on purpose.
