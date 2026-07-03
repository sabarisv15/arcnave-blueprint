# RESULT

## Files changed
- backend/src/routes/students.js (new)
- backend/tests/students.test.js (new)
- backend/src/tenantApp.js (one require + one `app.use()` line)

## What changed, per file
- `routes/students.js`: `createStudentsRouter()` factory, same shape as
  `routes/configurations.js` — `express.Router()`, routes relative to the
  eventual `/api/v1` mount, `asyncHandler` on every handler,
  `requireResolvedTenant(req, res)` copied verbatim, `client = req.dbClient`,
  `collegeId = req.collegeId`, `userId = req.jwtClaims.sub`. Five endpoints:
  `POST /students` (201), `GET /students/:id` (404 if `null`),
  `GET /students` (list, `?limit=&offset=` passed through as numbers or
  `undefined` — the 50/0 defaults live in the service/repository, not
  reimplemented here), `PUT /students/:id` (404 if `null`),
  `DELETE /students/:id` (204, or 404 if `null`). Error mapping:
  `StudentValidationError` → 400, `StudentRollNoConflictError` → 409, both
  via a small shared `mapStudentServiceError` helper used in the
  `create`/`update` handlers (the only two that can throw either — `remove`
  has no try/catch, since `removeStudent` doesn't raise either error).
  Writes gated with `requireRole('principal')`, reads with `requireAuth`,
  commented in-file as an explicit interim placeholder the same way
  `configurations.js` flagged its own principal-only gate — not a claim
  that principal-only editing is the real long-term rule. Request bodies
  are translated snake_case → camelCase via a local `STUDENT_BODY_FIELDS`
  map / `bodyToServiceFields()` (matches `StudentEditorModal.jsx`'s existing
  snake_case payload shape); responses are returned as studentRepository's
  native snake_case row, un-translated — picked because it's strictly less
  code than translating back, and the frontend already expects snake_case
  field names, so there's nothing to gain by reshaping on the way out.
- `tenantApp.js`: added `const createStudentsRouter = require('./routes/students');`
  next to the other route requires, and `app.use(createStudentsRouter());`
  in the same block as `createAuthRouter()`/`createConfigurationsRouter()`,
  after `tenantMiddleware` — no other change to this file.
- `students.test.js`: HTTP-level integration tests (same shape as
  `configurations.test.js`) against a live Postgres — all 5 endpoints,
  both error mappings hit via the real service/DB (a genuine duplicate
  `roll_no` on create, a genuine duplicate on update), 404 on unknown ids,
  RBAC (principal-only writes, any-authenticated-user reads, 401
  unauthenticated), an aadhaar-shaped field silently absent from the
  response, cross-tenant `roll_no` reuse, and one audit-log row per create.

## Tests
Ran against a throwaway `postgres:16` Docker container migrated through all
three existing migrations (roles created manually, matching
`docker/postgres/init/`), with `DATABASE_URL`/`MIGRATION_DATABASE_URL`/
`PLATFORM_DATABASE_URL`/`JWT_SECRET_KEY`/`PLATFORM_JWT_SECRET_KEY` set for
the process. Container removed after.

1. `node --check` on `routes/students.js` and `tenantApp.js` — clean.
2. `node --test tests/students.test.js` — **18/18 pass**, including:
   - `StudentValidationError` → 400 for a missing `roll_no` and, separately,
     a missing `full_name` — real service call, not a hand-thrown error.
   - `StudentRollNoConflictError` → 409 for (a) two `POST`s with the same
     `roll_no` in one tenant, and (b) a `PUT` that updates one student onto
     another's existing `roll_no` — both from the real
     `students_college_id_roll_no_key` constraint via a real `arcnave_app`
     connection, not simulated.
   - 404 on `GET`/`PUT`/`DELETE` for a nonexistent id; a second `DELETE`
     on an already-deleted id also 404s.
   - RBAC: `staff` gets 403 on `POST`; no token gets 401 on `POST` and on
     `GET`; `staff` gets 200 on `GET` (reads aren't principal-gated).
   - Cross-tenant: the same `roll_no` succeeds independently in two
     different tenants; tenant B can't `GET` tenant A's student by id
     (404, RLS-scoped).
   - Exactly one `student_created` audit row per successful create.
3. `node --test tests/` (full suite) — **106/106 pass**, no regressions.

## Flags / open questions
- **RBAC is a conservative placeholder, not a final decision** — per the
  task: BusinessRules.md's real rule (only the assigned Class Tutor may
  edit; only timetable-assigned faculty may view) can't be enforced today
  because "Class Tutor" isn't a resolved role (Module 2) and there's no
  timetable/assignment data yet (Module 3). `requireRole('principal')` on
  writes / `requireAuth` on reads is copied directly from
  `configurations.js`'s own precedent for this exact situation, and must be
  revisited once Module 2 resolves the Class Tutor question.
- **snake_case/camelCase translation is one-directional** — request bodies
  are translated (snake_case in, camelCase to the service); responses are
  returned as-is in the repository's native snake_case, not translated
  back. Explicitly the simpler of the two options the task offered; flagged
  in case round-tripping through camelCase is actually wanted for some
  future consumer of this API.
- **`GET /students` (list) has no RLS-independent tenant filter beyond
  what RLS already provides** — same as every other student lookup in this
  slice, tenant scoping is entirely `current_setting('app.current_tenant')`
  on the `req.dbClient` connection; there's no defense-in-depth
  `WHERE college_id = ...` at this layer for list specifically (unlike
  `findByRollNo`, which does filter explicitly for the non-globally-unique
  case). Consistent with how `studentRepository.list` was already written
  in the first slice, not a new decision here.
- **No route/UI change beyond the 5 endpoints and the one `tenantApp.js`
  hook** — no frontend repoint in this slice, per the task.
