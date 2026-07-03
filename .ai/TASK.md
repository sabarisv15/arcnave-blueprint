# TASK

## Objective
Module 3 (Academic), third vertical slice: API routes for `classes` —
`/api/v1/classes` — wired to `academicService.js`, no UI yet. Same
discipline as Module 2's third slice (`8333dec`, `routes/staff.js`):
snake_case<->camelCase body translation, domain-error-to-HTTP-status
mapping, the same conservative `requireRole('principal')`-for-writes/
`requireAuth`-for-reads placeholder pending `WorkflowService`.

## Grounding (read before assuming any route shape)
- `.ai/RESULT.md` (prior slice) for `academicService.js`'s exact
  function signatures/error classes — this slice wires to those
  verbatim, does not change them.
- `routes/staff.js` (the named pattern) and `routes/students.js`: the
  `requireResolvedTenant` guard, a `*_BODY_FIELDS` snake<->camel array
  local to the route file (not a shared util), `mapXServiceError`
  returning a boolean so the catch block can `throw err` for anything
  unmapped, responses left in the repository's native snake_case (not
  translated back), and the `{ actorUserId: req.jwtClaims.sub }` /
  `{ userId: req.jwtClaims.sub }` split on create vs. update/remove
  matching `academicService.js`'s own signatures.
- `backend/src/tenantApp.js`: routes are registered relative to the
  `/api/v1` mount point app.js supplies externally — `createClassesRouter()`
  added to the same `app.use(...)` block as students/staff, after
  `tenantMiddleware` like every other tenant-scoped route.
- `backend/src/middleware/rbac.js`: `requireAuth`/`requireRole` take
  no fixed role list — whatever role strings a route passes are
  checked against `req.jwtClaims.role` (already verified by
  `authMiddleware`). No DB lookup, no change needed here.

## Key design decision: same RBAC placeholder as staff/students, not an HOD-scoped one
BusinessRules.md's real rule is "Class Tutor is assigned only by HOD"
and the HOD/Principal timetable review chain
(`HodDashboard.jsx`/`PrincipalDashboard.jsx`'s `handleTimetableReview`).
Not enforced precisely here, for the same reason `staff.js`/
`students.js` already gave: no `WorkflowService` (Module 8) exists to
express "HOD may act only within their own department," and
`academicService.js` itself has no transition/approval logic yet (see
the second slice's `.ai/TASK.md`). `requireRole('principal')` gates
writes (`POST`/`PUT`/`DELETE`) — Principal is the one existing role
that is genuinely the final authority in every real chain
BusinessRules.md describes (staff/HOD registration both end with
Principal's approval; Principal is also the final timetable-review
gate per `PrincipalDashboard.jsx`); `requireAuth` gates reads. Flagged
as a placeholder to revisit once `WorkflowService` exists, not treated
as a final decision.

## Key design decision: tutor_user_id is a body field on generic create/update, not a dedicated endpoint
No `POST /classes/:id/assign-tutor`-style endpoint. `academicService.js`'s
second slice already decided tutor assignment goes through generic
`updateClass` (`tutorUserId` in `ALLOWED_FIELDS`), relying on the DB's
`UNIQUE (tutor_user_id)` to enforce "one class at a time" — this slice
just exposes that through the generic `PUT /classes/:id` body, same as
`staff.js` has no dedicated endpoint beyond generic `PUT /staff/:id`
either.

## Files likely affected
- `backend/src/routes/classes.js` (new)
- `backend/src/tenantApp.js` (add one `require` + one `app.use`)
- `backend/tests/classes.test.js` (new)

## Exact changes

**`routes/classes.js`** (mirrors `routes/staff.js`'s shape):
- `CLASS_BODY_FIELDS`: `class_name`/`department`/`semester`/
  `tutor_user_id`/`timetable_status`/`timetable_data`/
  `timetable_remarks` <-> their camelCase service-field names.
  `college_id` absent — always `req.collegeId`, never the body.
- `mapAcademicServiceError`: `ClassValidationError` -> 400,
  `ClassTimetableStatusError` -> 400, `ClassNameConflictError` -> 409,
  `ClassTutorConflictError` -> 409, `ClassTutorNotFoundError` -> 404.
- `POST /classes` (`requireRole('principal')`) -> `createClass`,
  `actorUserId: req.jwtClaims.sub`, 201.
- `GET /classes/:id` (`requireAuth`) -> `getClass`, 404 if `null`.
- `GET /classes` (`requireAuth`) -> `listClasses`, `limit`/`offset`
  passed through as-is (service/repository already default 50/0).
- `PUT /classes/:id` (`requireRole('principal')`) -> `updateClass`,
  `userId: req.jwtClaims.sub`, 404 if `null`.
- `DELETE /classes/:id` (`requireRole('principal')`) -> `removeClass`,
  `userId: req.jwtClaims.sub`, 204, 404 if `null`.

**`tenantApp.js`**: `require('./routes/classes')` +
`app.use(createClassesRouter())`, same block/order as students/staff.

## Acceptance criteria
- All 5 endpoints reachable at `/api/v1/classes[...]` against a real
  running server + live Postgres (not a mocked request/response pair).
- `POST` validates `class_name` (400) and `timetable_status` (400)
  before touching the DB, same as the service layer already does.
- Real DB constraint violations surface as the correct HTTP status:
  duplicate `class_name` in-tenant -> 409, tutor already assigned
  elsewhere -> 409 (on both create and update), nonexistent
  `tutor_user_id` -> 404 (on create) — proven with genuine Postgres
  errors, not hand-thrown ones.
- A class can be created/updated with no tutor at all, and two
  tutor-less classes can coexist (proves the nullable-unique
  NULL-coexistence behavior the first slice already verified at the
  DB level is reachable through the route too).
- Aadhaar-shaped/unrecognized body fields are silently dropped, never
  stored or echoed back.
- RBAC: writes 403 for a non-principal role, 401 unauthenticated;
  reads 200 for a non-principal authenticated role (`staff`), 401
  unauthenticated.
- Cross-tenant isolation: the same `class_name` is independently
  usable in two different tenants; a class from tenant A returns 404
  when fetched under tenant B's context (RLS enforced through the
  full route -> service -> repository -> DB path, not just the
  repository layer the first slice already proved).
- A create writes exactly one `audit_log` row with `action:
  'class_created'`, `entity: 'classes'`, attributed to the
  authenticated actor.
- Full backend suite passes with no regressions.
