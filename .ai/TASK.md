# TASK

## Objective
Module 1 (Student), second vertical slice: `StudentService` — business
logic + validation on top of `studentRepository.js`. Still no API/UI.

## Files likely affected
- `backend/src/services/studentService.js` (new)

## Context
- `backend/src/repositories/studentRepository.js` already exists:
  `create`, `findById`, `findByRollNo`, `update`, `remove`, `list`. It
  does zero validation beyond DB constraints (CLAUDE.md rule 1: AI
  tools call Business Services, never repositories directly — this
  slice is what makes that possible for students).
- Follow `services/configurationService.js` and `services/authService.js`
  conventions exactly (already-settled house style, don't reinvent):
  `'use strict'`, module-level comment stating scope, domain-specific
  `Error` subclasses (never raw repository/pg errors surfacing),
  every function takes `client` first then a destructured options
  object, `collegeId` passed explicitly even though `client` is
  already tenant-scoped (defense in depth, matches `authService.js`).

## Exact changes

**Validation** (BusinessRules.md Students + `StudentEditorModal.jsx`'s
required-field markers):
- `roll_no` and `full_name` are required — modal marks both with `*`
  and blocks its own "Next" step without them. Missing either throws
  a validation error before any repository call.
- No Aadhaar field accepted anywhere in the service's input shape
  (CLAUDE.md rule 8) — don't add a passthrough for it even if a
  caller sends one; drop/ignore it silently or reject it, pick one
  and note which.

**Duplicate roll number**:
- DB enforces `UNIQUE (college_id, roll_no)` already (constraint name
  `students_college_id_roll_no_key`). `createStudent` must catch that
  specific Postgres unique-violation (error code `23505`) and raise a
  domain error (e.g. `StudentRollNoConflictError`) — never let a raw
  pg error reach the caller, same discipline as
  `configurationService.js`'s `ConfigurationVersionConflictError`.

**Functions**:
- `createStudent(client, { collegeId, rollNo, fullName, ...rest, userId })`
  — validates, calls `studentRepository.create`, writes an
  `audit_log` entry via `auditLogRepository.createAuditLogEntry`
  (`action: 'student_created'`, `entity: 'students'`, `entityId` =
  new student's id) — same pattern `configurationService.setConfiguration`
  uses. Flag this audit-logging call as an assumption to confirm, not
  a settled requirement — BusinessRules.md doesn't explicitly mandate
  it for students, but it's the existing house convention for writes.
- `getStudent(client, id)` — passthrough to `findById`. `null` is not
  an error (matches `configurationService.getConfiguration`'s
  null-is-not-an-error stance) — that's a 404 at the route layer,
  which doesn't exist yet.
- `updateStudent(client, id, fields, { userId })` — passthrough to
  `update`, audit log entry (`action: 'student_updated'`) if a row
  was actually changed.
- `removeStudent(client, id, { userId })` — passthrough to `remove`,
  audit log entry (`action: 'student_removed'`). Still a hard delete
  (repository has no soft-delete column yet — unchanged open question
  from the first slice, don't resolve it here either).
- `listStudents(client, { limit, offset })` — passthrough to `list`.

**Explicitly out of scope for this slice** (don't build these — flag
if tempted):
- "Only the class tutor may edit" (BusinessRules.md Staff) is an
  authorization rule, not business logic — it belongs at the route/
  RBAC-middleware layer once Module 1's API exists, same as how
  `configurationService.js` left "writes gated to principal only" to
  `routes/configurations.js`, not to itself.
- No `WorkflowService` calls — it doesn't exist yet (Roadmap.md builds
  Workflow/Notifications after Attendance/Finance). BusinessRules.md's
  HOD-override exception for student-profile edits is out of scope
  until that module exists; don't stub it.
- No route, no API, no UI.

## Acceptance criteria
- `createStudent` rejects missing `roll_no` or `full_name` without
  touching the DB.
- `createStudent` on a duplicate `(college_id, roll_no)` raises a
  named domain error, not a raw pg error.
- No Aadhaar field accepted or passed through.
- Service calls only `studentRepository` and `auditLogRepository` —
  no other repository, no Storage, no WorkflowService.
- No service function does anything a route/RBAC layer should own
  (see "explicitly out of scope" above).
- No route, API, or UI code touched in this slice.
