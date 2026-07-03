# TASK

## Objective
Module 2 (Staff), second vertical slice: `StaffService` — business
logic + validation on top of `staffRepository.js`. Still no API/UI.

## Files likely affected
- `backend/src/services/staffService.js` (new)
- `backend/tests/staff-service.test.js` (new)

## Context
- `backend/src/repositories/staffRepository.js` already exists:
  `create`, `findById`, `findByUserId`, `findByStaffCode`, `update`,
  `remove`, `list`. It does zero validation beyond DB constraints
  (CLAUDE.md rule 1: AI tools call Business Services, never
  repositories directly — this slice is what makes that possible for
  staff).
- Follow `services/studentService.js` conventions exactly (already-
  settled house style for this exact kind of slice, don't reinvent):
  `'use strict'`, module-level comment stating scope, domain-specific
  `Error` subclasses (never raw repository/pg errors surfacing),
  every function takes `client` first, `collegeId` passed explicitly
  to `createStaff` even though `client` is already tenant-scoped
  (defense in depth, matches `authService.js`/`studentService.js`),
  `updateStaff`/`removeStaff`/`getStaff` don't take `collegeId` (id is
  globally unique, same convention as `studentService.js`).
- Reuses `.ai/TASK.md`'s Module 2 first-slice scope boundary
  unchanged: `staff` models an already-provisioned account
  (`user_id NOT NULL`, FK -> `users(id)`). This slice does not build
  any part of the HOD/Principal approval chain or credential
  generation (`generatedCreds` in `HodDashboard.jsx`/
  `PrincipalDashboard.jsx`) — that's account creation, a
  `users`-table concern for a future Module-0-adjacent or
  `WorkflowService` (Module 8) slice, not this one. `createStaff`
  here assumes a `userId` for an already-existing `users` row is
  handed in, same as `studentService.createStudent` assumes a valid
  `collegeId` is handed in rather than creating a college itself.

## Exact changes

**Validation** (`staff` schema's own `NOT NULL`s, same "what the DB
already demands, checked before the query" scope as
`studentService`'s `rollNo`/`fullName`):
- `userId` and `fullName` are required — `staff.user_id` and
  `staff.full_name` are both `NOT NULL` at the DB level. Missing
  either throws a validation error before any repository call.
- `staffCode` is explicitly **not** required — unlike `roll_no` on
  `students` (`NOT NULL`), `staff.staff_code` is nullable (see Module
  2 first slice's `.ai/TASK.md`: it's a freeform HR/biometric code,
  not every staff-creation path necessarily has one at creation time).
  Flagging this contrast so it isn't copy-pasted from
  `studentService`'s required-field pair without checking.
- No Aadhaar field accepted anywhere in the service's input shape
  (CLAUDE.md rule 8) — an `ALLOWED_FIELDS` whitelist (mirrors, but
  deliberately duplicates rather than imports, `staffRepository.js`'s
  `COLUMNS` list) silently drops it, same drop-not-reject treatment
  and same reasoning `studentService.js` already settled on: aadhaar
  gets no special-cased rejection beyond what any other
  unrecognized/typo'd field already gets. `collegeId` and `userId`
  are excluded from the whitelist used by `updateStaff` — a staff
  profile's tenant and account linkage are set once at creation and
  never move via update, same as `studentService`'s exclusion of
  `collegeId`.

**Conflict handling — two distinct unique constraints, not one**
(`staff` has `UNIQUE(user_id)` *and* `UNIQUE(college_id, staff_code)`,
unlike `students`' single `UNIQUE(college_id, roll_no)`): live-
verified against the real Docker Postgres this session that
node-postgres's error object exposes `err.constraint` with the exact
constraint name on a `23505`, so the two cases are distinguished by
`err.constraint`, not by re-parsing `err.message`:
  - `err.constraint === 'staff_user_id_key'` -> `StaffUserConflictError`
    (this `userId` already has a staff profile).
  - `err.constraint === 'staff_college_id_staff_code_key'` ->
    `StaffCodeConflictError` (this `staffCode` is already taken in
    this college).
  This is a deliberate departure from `platformService.js`'s
  `DuplicateCollegeError`, which intentionally does *not* distinguish
  `colleges`' two `UNIQUE` constraints (its comment: "no need to
  distinguish which for the caller"). Colleges' two constraints
  (`college_id`, `subdomain`) both mean the same thing to a caller —
  "this college already exists" — and that bundling was inherited
  from the prior Python version. Staff's two constraints mean
  genuinely different things with different remedies ("this person
  already has a staff profile — did you mean to edit it?" vs. "that
  staff code is taken — pick another"), so collapsing them the same
  way would lose information a future route/UI layer will want.
  Flagged as a considered deviation, not an inconsistency.
- `staffRepository.create`'s `userId` also carries a real FK
  (`staff_user_id_fkey` -> `users(id)`) — a `userId` for a
  non-existent user raises `23503` (foreign_key_violation), live-
  verified this session. Maps to `StaffUserNotFoundError`, following
  `platformService.js`'s existing `CollegeNotFoundError` precedent for
  mapping a `23503` on a single, unambiguous FK straight to a named
  error (staff has exactly one FK a caller could violate via
  `createStaff`'s inputs — `college_id` comes from the tenant-scoped
  request context, not caller-supplied free text, so only `user_id`
  is realistically wrong here).

**Functions**:
- `createStaff(client, { collegeId, userId, fullName, ...rest })` —
  validates, calls `staffRepository.create`, catches `23505`
  (branching on `err.constraint` as above) and `23503`
  (`staff_user_id_fkey` -> `StaffUserNotFoundError`), writes an
  `audit_log` entry via `auditLogRepository.createAuditLogEntry`
  (`action: 'staff_created'`, `entity: 'staff'`, `entityId` = new
  staff row's id) — same house convention `studentService`/
  `configurationService` use. Flagged the same way `studentService`'s
  `TASK.md` flagged it: an assumption carried forward from that
  precedent, not a restated BusinessRules.md mandate.
- `getStaff(client, id)` — passthrough to `findById`. `null` is not
  an error (matches `studentService.getStudent`'s stance) — 404 is a
  route-layer concern that doesn't exist yet.
- `updateStaff(client, id, fields, { userId })` — passthrough to
  `update` (same `ALLOWED_FIELDS`-filtered patch as create, minus
  `collegeId`/`userId`), catches `23505` on `staff_code` conflicts the
  same way create does (a `staffCode` change can collide with another
  row in the same college), audit entry (`action: 'staff_updated'`)
  only if a row was actually changed — same `hasChanges && result !==
  null` guard as `studentService.updateStudent`.
- `removeStaff(client, id, { userId })` — looks the row up first (to
  get `collegeId` for the audit entry and to skip logging a removal
  for an id that never existed, same as `studentService.removeStudent`),
  passthrough to `remove`, audit entry (`action: 'staff_removed'`).
  Still a hard delete — no soft-delete column exists yet, same
  unresolved open question carried forward from the first slice.
- `listStaff(client, { limit, offset })` — passthrough to `list`.

**Explicitly out of scope for this slice** (don't build these — flag
if tempted):
- The HOD/Principal approval chain and credential-generation step
  (`FacultyRegister.jsx` -> HOD approve -> Principal approve -> staff
  ID + credentials emailed) — this is `WorkflowService` (Module 8) +
  a `users`-row-creation step neither of which exists yet. Carried
  forward unchanged from the first slice's scope decision.
- "Only HOD/Principal may add staff" is an authorization rule, not
  business logic — left to the future route/RBAC layer, same
  reasoning `studentService.js` used for "only the class tutor may
  edit."
- No `WorkflowService` calls.
- No route, no API, no UI.

## Acceptance criteria
- `createStaff` rejects a missing `userId` or `fullName` without
  touching the DB.
- `createStaff` on a duplicate `user_id` raises `StaffUserConflictError`
  (not a raw pg error) — prove against the real Docker Postgres, not
  a hand-thrown `err.code`.
- `createStaff` on a duplicate `(college_id, staff_code)` raises
  `StaffCodeConflictError` — prove the same way, and prove it's
  distinguishable from the `user_id` conflict above (different error
  classes for different `err.constraint` values).
- `createStaff` with a `userId` that doesn't exist in `users` raises
  `StaffUserNotFoundError`, not a raw FK violation.
- No Aadhaar field accepted or passed through.
- Service calls only `staffRepository` and `auditLogRepository` — no
  other repository, no Storage, no `WorkflowService`.
- No service function does anything a route/RBAC layer should own
  (see "explicitly out of scope" above).
- No route, API, or UI code touched in this slice.
