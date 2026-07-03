# TASK

## Objective
Module 2 (Staff), third vertical slice: API routes on top of
`staffService.js`. Still no UI repoint.

## Files likely affected
- `backend/src/routes/staff.js` (new)
- `backend/src/tenantApp.js` (add one require + one `app.use()` line,
  same as `createStudentsRouter`, no other change)
- `backend/tests/staff.test.js` (new)
- `backend/src/services/staffService.js` (bugfix, found while drafting
  this slice — see below, not a route/API change)

## Context
- `backend/src/services/staffService.js` already exists: `createStaff`,
  `getStaff`, `updateStaff`, `removeStaff`, `listStaff`, plus
  `StaffValidationError`, `StaffUserConflictError`,
  `StaffCodeConflictError`, `StaffUserNotFoundError`.
- Follow `routes/students.js` exactly (closest precedent — same
  shape, one module ahead in the build order): factory function
  `createStaffRouter()` returning an `express.Router()`, routes
  registered relative to the eventual `/api/v1` mount, `asyncHandler`
  wrapping every handler, `requireResolvedTenant(req, res)` guard
  copied the same way, `client` = `req.dbClient`, `collegeId` =
  `req.collegeId`.

## Pre-existing bugfix found while drafting this slice
`staffService.createStaff`'s signature (`{ collegeId, userId, fullName,
...rest }`, single options object) makes `userId` do double duty: it's
both the new staff row's own account link (`staff.user_id` — required,
FK'd) **and** the only candidate for who the `audit_log` entry
attributes the action to. Those are two different people in the real
flow this module is grounded against — a principal/HOD adds a profile
*for* an already-provisioned staff member (`HodDashboard.jsx`/
`PrincipalDashboard.jsx`'s Add Staff modal); the actor is whoever is
authenticated on the request, the subject is the staff member named in
the request body. `studentService.createStudent` never had this
problem because `students` has no `user_id` column at all — its
`userId` param only ever meant "the actor." `staffService.createStaff`
needs both concepts and only had room for one.

Fixed in `staffService.js`: `createStaff` now takes a third parameter,
`{ actorUserId }`, used only for the audit entry; the existing `userId`
in the first object keeps meaning "the staff row's own account" only.
`updateStaff`/`removeStaff` are unaffected — their `{ userId }` already
meant "the actor" only, since neither touches `staff.user_id` (excluded
from `ALLOWED_FIELDS`). One new unit test added to
`staff-service.test.js` proving the audit entry is attributed to
`actorUserId`, not the subject's `userId`. This is out of this route
slice's original file list, same as `studentRepository.js`'s create-NULL
fix was out of `studentService.js`'s slice — the route layer couldn't
be wired correctly without it (a route has exactly one authenticated
actor and needs to pass a *different* user_id for the profile being
created).

## Exact changes

**Endpoints**:
- `POST /staff` — `createStaff`. 201 on success.
- `GET /staff/:id` — `getStaff`. 404 if `null`.
- `GET /staff` — `listStaff`. `?limit=&offset=` passed through as-is.
- `PUT /staff/:id` — `updateStaff`. 404 if `null`.
- `DELETE /staff/:id` — `removeStaff`. 404 if `null`, else 204.

**Request/response body shape — snake_case, not camelCase**, same
reasoning as `students.js` (no `StaffEditorModal.jsx` exists to ground
against directly, but the HOD/Principal `staffForm` in
`HodDashboard.jsx`/`PrincipalDashboard.jsx` and the DB columns
themselves are both already snake_case-shaped). A `STAFF_BODY_FIELDS`
map, same pattern as `STUDENT_BODY_FIELDS`, translates the request
body to the camelCase `staffService` expects. `user_id` **is** in this
map (unlike `students.js`, where no such mapping exists because
students have no `user_id` column) — it's how the route learns which
already-provisioned account this profile belongs to; `college_id` is
not in the map, same as `students.js` (always `req.collegeId`, never
caller-supplied). Response bodies: repository's native snake_case row
shape, unchanged, same choice `students.js` made and same reasoning
(strictly less code, nothing downstream expects camelCase yet).

**Error mapping**:
- `StaffValidationError` -> 400
- `StaffUserConflictError` -> 409
- `StaffCodeConflictError` -> 409
- `StaffUserNotFoundError` -> 404 — follows `platformService.js`'s
  `CollegeNotFoundError` -> 404 precedent (`routes/platform.js`): the
  referenced resource (the `user_id` named in the body) doesn't exist,
  same shape of failure, same status code chosen for it elsewhere in
  this codebase.
- Service returning `null` (not thrown) -> 404, per endpoint as listed
  above.

**RBAC — same conservative placeholder as `students.js`, not a final
decision**: BusinessRules.md's actual Staff registration chain (Faculty
submits -> HOD approves -> Principal approves -> WorkflowService) can't
be enforced today — no WorkflowService (Module 8), and this slice's
`staffService` doesn't model a pending/approval state at all (see
Module 2 first slice's scope boundary). `requireRole('principal')`
gates writes, `requireAuth` gates reads — identical to `students.js`,
not `requireRole('principal', 'hod')`: both registration chains
(Staff and HOD) end with *Principal* giving final approval, so
Principal is the one existing role that's actually the final authority
in every real chain BusinessRules.md describes; gating on HOD alone
would let through an action the real business rule treats as only
provisional. Must be revisited once WorkflowService exists.

**`tenantApp.js`**: add `const createStaffRouter = require('./routes/staff');`
and `app.use(createStaffRouter());` in the same block as
`createStudentsRouter()`.

## Acceptance criteria
- All 5 endpoints wired, thin translation layer only.
- `StaffValidationError` -> 400, `StaffUserConflictError` -> 409,
  `StaffCodeConflictError` -> 409, `StaffUserNotFoundError` -> 404,
  not-found -> 404 — verified against the actual service hitting real
  DB constraints (real `23505`/`23503`), not hand-thrown errors, same
  rigor as `students.test.js`.
- The `actorUserId`/`userId` split (see bugfix above) is exercised
  live: a `staff_created` audit_log row attributed to the
  authenticated caller (e.g. `principaluser`'s own id), not to the
  `user_id` named in the request body.
- Writes require `principal` role; reads require any authenticated
  tenant user.
- Cross-tenant isolation: the same `staff_code` is independently usable
  across two tenants; a staff row from one tenant 404s when fetched
  through another tenant's token.
- No other repository, no Storage, no `WorkflowService` reached from
  this file — only `staffService.js`.
- No UI code touched in this slice.
