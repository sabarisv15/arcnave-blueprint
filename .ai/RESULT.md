# RESULT

## Files changed
- backend/src/routes/staff.js (new)
- backend/src/tenantApp.js (2 lines: require + app.use, same block as
  createStudentsRouter)
- backend/tests/staff.test.js (new)
- backend/src/services/staffService.js (bugfix, out of this slice's
  original file list — see below)
- backend/tests/staff-service.test.js (1 new unit test covering the
  bugfix)

## What changed, per file
- `staff.js`: `createStaffRouter()` factory, mirrors `routes/students.js`
  exactly. Five endpoints (`POST/GET/GET-list/PUT/DELETE /staff`), a
  `STAFF_BODY_FIELDS` snake_case<->camelCase map (includes `user_id`,
  unlike `students.js`'s map — see Context below), `mapStaffServiceError`
  translating all four `staffService` domain errors to HTTP status
  (`StaffValidationError`->400, `StaffUserConflictError`->409,
  `StaffCodeConflictError`->409, `StaffUserNotFoundError`->404,
  following `platformService.js`'s `CollegeNotFoundError`->404
  precedent), `requireRole('principal')` on writes /
  `requireAuth` on reads (same conservative placeholder `students.js`
  uses, documented in-file). Response bodies are the repository's
  native snake_case row shape, untranslated — same choice/reasoning as
  `students.js`.
- `tenantApp.js`: added `const createStaffRouter = require('./routes/staff');`
  and `app.use(createStaffRouter());` in the same block as
  `createStudentsRouter()`. No other change.
- `staff.test.js`: 21 integration subtests over real HTTP against a
  live server + live Postgres — CRUD mechanics, all four error->status
  mappings proven against genuine DB constraint violations (not
  hand-thrown), RBAC (write requires principal, read requires any
  auth), cross-tenant isolation (same `staff_code` independently usable
  across two tenants; a tenant-A row 404s through tenant B's token),
  and one test proving the `actorUserId` fix (see below) end-to-end:
  the `staff_created` audit row is attributed to the authenticated
  caller, not the `user_id` named in the request body.
- `staffService.js` (bugfix): `createStaff`'s signature was
  `(client, { collegeId, userId, fullName, ...rest })` — a single
  `userId` doing double duty as both the new staff row's own account
  link (`staff.user_id`, required, FK'd) *and* the only candidate for
  who the `audit_log` entry attributes the action to. Those are
  different people in the real flow this module is grounded against
  (a principal adds a profile *for* an already-provisioned staff
  member). Fixed by adding a third parameter, `{ actorUserId } = {}`,
  used only for the audit entry; `userId` in the first object now only
  ever means "the staff row's own account." `updateStaff`/`removeStaff`
  were already correct (their `{ userId }` always meant "the actor" —
  neither touches `staff.user_id`, which is excluded from
  `ALLOWED_FIELDS`) and are unchanged.
- `staff-service.test.js`: added
  `'createStaff attributes the audit entry to actorUserId, not the new
  staff row's own userId'`, proving the fix at the unit level (stubbed
  repos) in addition to `staff.test.js`'s live-DB proof.

## Tests
1. **Unit (no DB)** — `node --test tests/staff-service.test.js`:
   16/16 pass (15 prior + 1 new for the `actorUserId` fix).
2. **Live integration, against the real docker-compose Postgres**
   (`docker compose up -d db`, real `postgres:16`, already running
   from the prior slice's verification, reused here) —
   `node --test tests/staff.test.js`: **21/21 pass.** Real HTTP server
   (`app.listen(0)`), real login flow issuing real JWTs, real
   `arcnave_app` connections hitting real RLS-scoped Postgres.
   Notable specific proofs, not just "endpoint returns 2xx":
   - `StaffUserConflictError` -> 409 from a genuine duplicate `user_id`
     insert (real `23505` on `staff_user_id_key`).
   - `StaffCodeConflictError` -> 409 from a genuine duplicate
     `(college_id, staff_code)` insert, both on create and on update.
   - `StaffUserNotFoundError` -> 404 from a genuine FK violation
     (`user_id` that doesn't exist in `users`).
   - `update` cannot move `staff.user_id` — sending a different
     `user_id` in a `PUT` body is silently ignored (`ALLOWED_FIELDS`
     excludes it), the row's `user_id` is unchanged afterward —
     verified by reading the response body's `user_id` post-update,
     not just that the call didn't error.
   - The `actorUserId` fix, live: created a staff profile for a
     freshly-seeded `subject` account while authenticated as
     `principaluser`, then read the resulting `audit_log` row directly
     via the admin connection and asserted `user_id` equals
     `principaluser`'s id, not the subject's id.
   - Cross-tenant: identical `staff_code` value accepted in two
     different tenants; a row created in tenant A returns 404 when
     fetched through tenant B's token.
   - RBAC: write as `staffuser` (role `staff`) -> 403; write with no
     token -> 401; read as `staffuser` -> 200 (reads are role-agnostic,
     only auth-gated).
3. **Full existing suite regression check** — `node --test tests/`
   (all files, not just the new ones, unlike the Module 2 first
   slice's flagged gap): **143/143 pass**, 0 fail. Confirms the
   `staffService.js` signature change didn't break anything else
   calling it (nothing else does yet) and that wiring a new router
   into `tenantApp.js` didn't disturb any other route's behavior.
4. **DB left clean** — verified via direct count queries after the
   full suite run: 0 rows in `staff`, 0 `colleges` matching this
   session's `stf%` test-tenant prefix, 0 leftover `users` from any
   test-created account. Every test's own cleanup (`cleanupTenant` in
   `staff.test.js`, deleting `audit_log` -> `staff` -> `refresh_tokens`
   -> `users` -> `colleges` in FK-safe order) ran successfully.
5. `node --check` on all 4 changed/new backend files — PASS.

## Flags / open questions
- **The `actorUserId` bugfix is out of this slice's original file
  list** (`staffService.js` wasn't supposed to change for a "just add
  routes" slice) — same situation `studentRepository.js`'s create-NULL
  fix was in during the Module 1 service slice: the route layer
  genuinely could not be wired correctly without it, since a route has
  exactly one authenticated actor (`req.jwtClaims.sub`) and needed to
  pass a *different* `user_id` for the profile being created. Flagging
  again in case this should've been its own separate commit.
- **RBAC is still the same conservative placeholder as `students.js`**
  — `requireRole('principal')` for writes, not the real Staff/HOD
  registration chain (Faculty submits -> HOD approves -> Principal
  approves -> WorkflowService), which can't be enforced today (no
  WorkflowService, no pending-approval state in `staffService`).
  Considered `requireRole('principal', 'hod')` and rejected it — both
  real registration chains end with Principal's final approval, so
  gating on HOD alone would let through an action BusinessRules.md
  treats as only provisional. Must be revisited once WorkflowService
  (Module 8) exists.
- **No route/API for the self-registration / pending-approval state**
  — unchanged flag carried forward from both prior slices:
  `FacultyRegister.jsx`'s "submit, wait for HOD/Principal approval"
  flow still has no backing table, service path, or route.
- **Soft delete still unresolved** — `DELETE /staff/:id` is still a
  hard delete, unchanged open question carried forward twice now.
