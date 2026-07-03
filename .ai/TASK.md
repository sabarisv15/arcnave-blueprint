# TASK

## Objective
Module 1 (Student), third vertical slice: API routes on top of
`studentService.js`. Still no UI repoint — that's the next slice
after this one.

## Files likely affected
- `backend/src/routes/students.js` (new)
- `backend/src/tenantApp.js` (add one require + one `app.use()` line,
  same as `createConfigurationsRouter` and `createAuthRouter` — no
  other change to this file)

## Context
- `backend/src/services/studentService.js` already exists:
  `createStudent`, `getStudent`, `updateStudent`, `removeStudent`,
  `listStudents`, plus `StudentValidationError` and
  `StudentRollNoConflictError`.
- Follow `routes/configurations.js` exactly — it's the closest
  precedent (RLS-scoped tenant resource, service-layer domain
  errors, optimistic-style conflict mapping): factory function
  `createStudentsRouter()` returning an `express.Router()`, routes
  registered relative to the eventual `/api/v1` mount (CLAUDE.md rule
  5 — the prefix is supplied externally by `tenantApp.js`, never
  hardcoded here), `asyncHandler` wrapping every handler,
  `requireResolvedTenant(req, res)` guard copied the same way, `client`
  = `req.dbClient`, `collegeId` = `req.collegeId`, `userId` =
  `req.jwtClaims.sub`.

## Exact changes

**Endpoints**:
- `POST /students` — `createStudent`. 201 on success.
- `GET /students/:id` — `getStudent`. 404 if `null`.
- `GET /students` — `listStudents`. Accepts `?limit=&offset=` query
  params, passed through as-is (service/repository already default
  them to 50/0 — don't re-implement that default here).
- `PUT /students/:id` — `updateStudent`. 404 if the service returns
  `null` (id not found).
- `DELETE /students/:id` — `removeStudent`. 404 if `null`, else 204.

**Request/response body shape — snake_case, not camelCase**:
`StudentEditorModal.jsx` (the frontend this module will eventually
repoint) already POSTs a snake_case payload (`roll_no`, `full_name`,
`mark_10th`, ...) matching the DB columns directly — see its
`handleSave`. Translate snake_case body keys to the camelCase params
`studentService` expects at the route boundary (a small mapping
function in this file, not a shared util yet — one file uses it so
far). This keeps the later UI-repoint slice a URL/fetch-path change,
not a payload-reshaping one. Response bodies: same translation in
reverse, or just return the repository's native row shape
(snake_case, since that's what Postgres returns) — pick whichever
keeps this file simplest and say which you picked.

**Error mapping** (same discipline as `configurations.js`'s
`ConfigurationVersionConflictError` → 409 catch):
- `StudentValidationError` → 400
- `StudentRollNoConflictError` → 409
- Service returning `null` (not a thrown error) → 404, per endpoint
  as listed above.

**RBAC — conservative default, explicitly not a final decision**:
BusinessRules.md's Staff section says only the assigned Class Tutor
may edit a student profile, and only faculty assigned via the
timetable may view one — but "Class Tutor" isn't a resolved role yet
(BusinessRules.md flags this as open, to be resolved in Module 2) and
there's no timetable/assignment data yet (Module 3, not built).
Neither can be enforced correctly today. Match
`configurations.js`'s own precedent for exactly this situation: gate
writes (`POST`/`PUT`/`DELETE`) with `requireRole('principal')` — a
real, working role string already used elsewhere in this codebase —
and reads (`GET`) with `requireAuth` (any authenticated tenant user).
This is a deliberately conservative placeholder, not a claim that
principal-only editing is correct long-term; comment it the same way
`configurations.js` did, and it must be revisited once Module 2
resolves the Class Tutor role question.

**`tenantApp.js`**: add `const createStudentsRouter = require('./routes/students');`
near the other route requires, and `app.use(createStudentsRouter());`
in the same block as `createAuthRouter()`/`createConfigurationsRouter()`
(after `tenantMiddleware`, not before — these are ordinary tenant-scoped
routes, not `/health`- or `/invitations/accept`-style exceptions).

## Acceptance criteria
- All 5 endpoints wired, each a thin translation layer — no business
  logic here that isn't already in `studentService.js`.
- `StudentValidationError` → 400, `StudentRollNoConflictError` → 409,
  not-found → 404, verified against the actual service (not
  hand-thrown errors in a test), same rigor as the service slice's
  live-DB duplicate-roll-no test.
- Writes require `principal` role; reads require any authenticated
  tenant user — both flagged in-file as an interim default per above.
- No other repository, no Storage, no WorkflowService reached from
  this file — only `studentService.js`.
- No UI code touched in this slice.
