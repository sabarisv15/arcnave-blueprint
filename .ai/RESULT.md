# RESULT

## Files changed
- `backend/src/services/academicService.js` (new)
- `backend/tests/academic-service.test.js` (new)

## What changed, per file
- `academicService.js`: business logic over `classRepository.js` —
  five error classes (`ClassValidationError`,
  `ClassTimetableStatusError`, `ClassNameConflictError`,
  `ClassTutorConflictError`, `ClassTutorNotFoundError`), an
  `ALLOWED_FIELDS` whitelist (`className`, `department`, `semester`,
  `tutorUserId`, `timetableStatus`, `timetableData`,
  `timetableRemarks` — `collegeId` excluded, set once at creation),
  and `createClass`/`getClass`/`updateClass`/`removeClass`/
  `listClasses`. Mirrors `staffService.js`'s shape exactly, including
  its corrected signature split (`{ actorUserId }` on create vs.
  `{ userId }` on update/remove).
  - `assertValidTimetableStatus` is the one piece with no direct
    `staffService.js` analogue: it rejects any `timetableStatus`
    outside the five literals (`'No Tutor'`, `'Pending HOD'`,
    `'Pending Principal'`, `'Approved'`, `'Rejected'`) on both create
    and update. This isn't invented here — the Module 3 migration's
    own comment names this exact gap and says it's "enforced at the
    service layer once AcademicService exists, not the DB." It
    validates the value is a known literal only; it does not check
    that a given transition is legal from the row's current state
    (e.g. it will not stop `'No Tutor'` -> `'Approved'` directly) —
    that's real HOD/Principal review-chain logic, explicitly left to
    `WorkflowService` (Module 8, doesn't exist yet), same as
    `studentService.js` left the HOD-override exception out of its
    own second slice. See `.ai/TASK.md`.
  - The three constraint mappings (`classes_college_id_class_name_key`,
    `classes_tutor_user_id_key` -> 23505; `classes_tutor_user_id_fkey`
    -> 23503) use the exact constraint names the first slice's
    `.ai/RESULT.md` already live-verified against a real Postgres
    (not guessed from the migration's DDL).
  - `findByTutorUserId`/`findByCollegeAndClassName` deliberately have
    no service-layer wrapper in this slice, matching
    `staffService.js`'s own precedent of leaving
    `findByUserId`/`findByStaffCode` unwrapped in its second slice.

## Tests
No DB required for this slice — `academic-service.test.js` follows
`staff-service.test.js`'s technique exactly: `node:test`'s built-in
`t.mock.method` stubs `classRepository`/`auditLogRepository` (works
because `academicService` always calls e.g. `classRepository.create(...)`
as a fresh property lookup, never a destructured local). 19 subtests,
all passing:

- `createClass` rejects a missing `className` and an unknown
  `timetableStatus` without touching the repository (2 tests).
- `createClass` accepts each of the five known `timetableStatus`
  literals (1 test, looped).
- `createClass` doesn't require `department`/`semester`/`tutorUserId`
  (1 test).
- `createClass` drops an unrecognized (aadhaar-shaped) field instead
  of passing it through (1 test).
- `createClass` attributes the audit entry to `actorUserId`, with
  `action: 'class_created'`/`entity: 'classes'` (1 test).
- `createClass` maps all three constraint violations
  (`classes_college_id_class_name_key`, `classes_tutor_user_id_key`,
  `classes_tutor_user_id_fkey`) to their domain errors via hand-thrown
  `err.code`/`err.constraint` (3 tests).
- `createClass` lets a non-conflict repository error pass through
  unchanged, not swallowed (1 test).
- `updateClass` rejects an unknown `timetableStatus` without touching
  the repository (1 test).
- `updateClass` writes an audit entry only when a recognized field
  changed on an existing row; no-op and not-found paths write nothing
  (3 tests).
- `updateClass` maps the name-conflict and tutor-conflict violations
  (2 tests).
- `removeClass` is a no-op with no audit entry against a nonexistent
  id, and deletes + audits against an existing one (2 tests).

Ran `node --test tests/academic-service.test.js` (19/19 pass) and
`node --test tests/staff-service.test.js tests/academic-service.test.js`
together (35/35 pass, confirms no shared-mock leakage between the two
files' stubbed repositories). Also ran `node --check
src/services/academicService.js` (no syntax errors) and the full
`node --test tests/` suite: the same 12 integration-test files that
need a live Postgres/Docker (`auth`, `configurations`, `platform`,
`principal-invitation`, `rbac`, `request-logging`, `staff`, `students`,
`tenant-middleware`, plus the tenant-isolation/RLS-negative-control
subtests) fail here exactly as they did in the prior slice's
documented sandbox constraint (no Docker, no root) — unrelated to this
change, not newly broken by it.

What's deliberately **not** tested here, same as
`staff-service.test.js`'s own stated gap: an actual
`classes_college_id_class_name_key`/`classes_tutor_user_id_key`/
`classes_tutor_user_id_fkey` violation reaching its domain error
end-to-end through a real Postgres constraint, not a hand-thrown
`err.code`/`err.constraint`. The first slice's `.ai/RESULT.md` already
live-verified those exact constraint names exist and fire correctly
against a real database; this slice trusts that grounding rather than
re-running the embedded-postgres harness for a service layer that adds
no new SQL of its own.

## Flags / open questions
- **No HOD/Principal review-chain transition enforcement** —
  `assertValidTimetableStatus` only checks the target value is one of
  the five known literals, not that the transition from the row's
  current status is legal. Real transition logic
  (`'Pending HOD'` -> `'Approved'`/`'Pending Principal'`/`'Rejected'`,
  etc.) belongs to `WorkflowService` (Module 8) per CLAUDE.md rule 3
  and doesn't exist yet — flagged, not silently skipped. See
  `.ai/TASK.md`.
- **No `assignTutor`-specific function** — tutor assignment goes
  through the generic `updateClass` (`tutorUserId` is in
  `ALLOWED_FIELDS`), relying on the DB's `UNIQUE (tutor_user_id)` to
  enforce "one class at a time," same as `staffService.js` has no
  dedicated function beyond generic `updateStaff` either. "Only HOD
  may assign a Class Tutor" (BusinessRules.md Staff) is left to the
  route/RBAC layer once Module 3's API exists, same authorization-vs-
  business-logic split `staffService.js` already drew.
- **No API route or UI in this slice** — matches Module 1's and
  Module 2's own second-slice scope (both prior `RESULT.md`s changed
  only a service file plus its tests).
- **Sandbox has no Docker/root** — same documented constraint as the
  prior two slices; this slice sidesteps it entirely since its tests
  are pure unit tests against stubbed repositories, needing no live
  DB at all.
