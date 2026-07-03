# RESULT

## Files changed
- `backend/src/routes/classes.js` (new)
- `backend/src/tenantApp.js` (wired the new router in)
- `backend/tests/classes.test.js` (new)

## What changed, per file
- `routes/classes.js`: five endpoints (`POST`/`GET :id`/`GET`
  (list)/`PUT :id`/`DELETE :id` under `/classes`) over
  `academicService.js`, mirroring `routes/staff.js`'s shape exactly —
  a local `CLASS_BODY_FIELDS` snake<->camel translation table,
  `requireResolvedTenant` guard, `mapAcademicServiceError` mapping all
  five of `academicService.js`'s error classes
  (`ClassValidationError`/`ClassTimetableStatusError` -> 400,
  `ClassNameConflictError`/`ClassTutorConflictError` -> 409,
  `ClassTutorNotFoundError` -> 404), and the same `{ actorUserId:
  req.jwtClaims.sub }` (create) / `{ userId: req.jwtClaims.sub }`
  (update/remove) split `academicService.js`'s signatures require.
  RBAC: `requireRole('principal')` on writes, `requireAuth` on reads —
  the same deliberately conservative placeholder `staff.js`/
  `students.js` use, not a final decision (see `.ai/TASK.md`'s design
  decision section for why an HOD-scoped rule isn't possible yet).
- `tenantApp.js`: added `const createClassesRouter =
  require('./routes/classes')` and `app.use(createClassesRouter())` in
  the same block as students/staff, after `tenantMiddleware` — a
  2-line change, nothing else touched.

## Tests
Unlike the first two Module 3 slices, **this sandbox has a real,
already-running Docker Postgres** (`arcnave-blueprint-db-1`,
`postgres:16`, port 5432 mapped to the host) — a different environment
than the two prior slices' documented "no Docker, no root" constraint.
Confirmed via `docker ps`/`docker exec ... psql \dt`: the container was
already running with Module 0-2's tables but not yet `classes` —
Module 3's migration (`1752000000000_module-3-academic-schema.js`) had
been committed in the first slice but never actually applied to this
particular running instance. Ran it for real: `MIGRATION_DATABASE_URL`
pointed at `localhost:5432` (the docker-compose network hostname `db`
doesn't resolve from outside the container), `npm run migrate` — one
migration applied cleanly, `classes` now exists with the exact
constraint names (`classes_college_id_class_name_key`,
`classes_tutor_user_id_key`, `classes_tutor_user_id_fkey`) the first
slice's `.ai/RESULT.md` had already predicted from a *different*
embedded-postgres instance — confirms that prior verification
generalizes to the real docker-compose database, not just the scratch
harness it was proven against.

`classes.test.js` follows `staff.test.js`'s technique: real HTTP
requests (`node:http`) against a real running Express server + this
live Postgres, with `DATABASE_URL`/`MIGRATION_DATABASE_URL`/
`PLATFORM_DATABASE_URL`/`JWT_SECRET_KEY`/`PLATFORM_JWT_SECRET_KEY` all
pointed at `localhost` (rewritten from the `.env` docker-network
values) rather than mocks. 24 subtests, all passing:

- Create: 201 with the row (2), missing `class_name` -> 400,
  unknown `timetable_status` -> 400, no `tutor_user_id` required
  (tutor stays `null`), duplicate `class_name` in-tenant -> real 409,
  tutor already tutoring another class -> real 409, two classes with
  no tutor coexist, nonexistent `tutor_user_id` -> real 404,
  aadhaar-shaped field dropped (8 tests).
- Get by id: 200 existing / 404 unknown (1 test).
- List: respects `limit` (1 test).
- Update: field change -> 200, unknown id -> 404, unknown
  `timetable_status` -> 400, `class_name` conflict -> real 409, tutor
  conflict -> real 409 (5 tests).
- Delete: 204 then 404 on repeat (1 test).
- RBAC: write 403 non-principal, write 401 unauthenticated, read 200
  for `staff` role, read 401 unauthenticated (4 tests).
- Cross-tenant: same `class_name` usable in two tenants, a tenant-A
  class 404s when fetched as tenant B (1 test).
- Audit: exactly one `audit_log` row, `entity: 'classes'`, attributed
  to the authenticated actor, on create (1 test).

Ran `node --test tests/classes.test.js` (24/24 pass), then the full
`npm test` (`node --test tests/`) suite against the same live
database: **186/186 pass, zero failures** — every integration test
that failed in the prior two slices' sandbox (auth, configurations,
platform, staff, students, tenant-middleware, rbac,
principal-invitation, request-logging) now passes too, since a real
Postgres is actually reachable in this session. No regressions from
this change. Also ran `node --check` on both new/changed files.

## Flags / open questions
- **RBAC is still the placeholder, not a final HOD-scoped rule** —
  same open item `staff.js`/`students.js` already carry: revisit once
  `WorkflowService` (Module 8) exists and can express "HOD may act
  only within their own department."
- **No HOD/Principal timetable-review transition endpoint** — this
  slice exposes `timetable_status` as a plain field on generic
  `PUT /classes/:id`, not a `POST /classes/:id/review`-style action
  endpoint with `'Approve'`/`'Forward'`/`'Reject'` semantics matching
  `HodDashboard.jsx`/`PrincipalDashboard.jsx`'s `handleTimetableReview`.
  That's real workflow-transition logic, consistently deferred since
  the second slice to `WorkflowService`, not built here either.
- **This session's sandbox has Docker** — worth noting for whichever
  slice runs next: unlike the first two Module 3 slices (documented
  "no Docker, no root," verified via a scratch `embedded-postgres`
  harness instead), this session found a real `docker compose`
  Postgres already running. If a future session lands back in a
  no-Docker sandbox, that's an environment difference between
  sessions, not a regression — don't be alarmed if `docker ps` comes
  back empty next time.
- **No UI in this slice** — matches Module 1's and Module 2's own
  third-slice scope (API routes only; the UI repoint is always a
  separate, later slice — see Module 2's fourth slice, `49c2c36`).
