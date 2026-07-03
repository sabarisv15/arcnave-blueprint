# TASK

## Objective
Module 3 (Academic), second vertical slice: `AcademicService` —
business logic over `classRepository.js`, no API route or UI yet.
Same discipline as Module 2's second slice (`86fa63b`,
`staffService.js`): domain errors instead of raw pg errors, an
`ALLOWED_FIELDS` whitelist, audit-log entries on create/update/remove.

## Grounding (read before assuming any function list)
- `.ai/RESULT.md` (prior slice) and the Module 3 migration
  (`backend/migrations/1752000000000_module-3-academic-schema.js`)
  itself: its own top-of-file comment already names this slice's job
  precisely — `timetable_status` has no DB-level CHECK constraint,
  "known real values, enforced at the service layer once
  AcademicService exists, not the DB: `'No Tutor'` | `'Pending HOD'` |
  `'Pending Principal'` | `'Approved'` | `'Rejected'`." This slice is
  that enforcement — not invented fresh, it was flagged as this exact
  slice's job by name.
- `staffService.js` (the named pattern): error-class-per-constraint
  style, `ALLOWED_FIELDS`/`pickXFields` whitelist, `{ actorUserId }`
  on create vs. `{ userId }` on update/remove (a corrected asymmetry
  `staffService.js` itself documents finding while wiring its route
  layer — followed here rather than `studentService.js`'s older,
  uncorrected signature).
- `docs/architecture/BusinessRules.md` Academic/Timetable and Staff
  sections: "Class Tutor is assigned only by HOD, for one class at a
  time" (already enforced at the DB level by `UNIQUE
  (tutor_user_id)` — this slice's job is to surface that constraint
  as a domain error, not re-implement the rule); CLAUDE.md rule 3
  (`WorkflowService` is the sole approval gate) and rule 7 (Academic
  before Attendance, gated on `timetable_status == 'Approved'`).

## Key design decision: no HOD/Principal review-chain transition logic yet
`HodDashboard.jsx`/`PrincipalDashboard.jsx`'s `handleTimetableReview`
implies a real state machine (`'Pending HOD'` ->
`'Approved'`/`'Pending Principal'`/`'Rejected'`, `'Pending Principal'`
-> `'Approved'`/`'Rejected'`). Not built in this slice: CLAUDE.md rule
3 makes `WorkflowService` the sole approval gate for exactly this kind
of transition, and it doesn't exist yet (Roadmap.md builds
Workflow/Notifications after Attendance/Finance/Documents/Reports) —
the same "out of scope here, not stubbed" reasoning
`studentService.js` used for BusinessRules' HOD-override exception on
student-profile edits. What this slice *does* do:
`assertValidTimetableStatus` rejects any value outside the five known
literals, so a typo or garbage value can never reach the DB — that
much is plain input validation, not a workflow transition rule (it
doesn't check *which* transitions are legal from the current state,
only that the target value is a real one).

## Key design decision: no wrapper for `findByTutorUserId`/`findByCollegeAndClassName`
`staffService.js`'s own second slice left `staffRepository.findByUserId`
and `findByStaffCode` unwrapped — not every repository export gets a
same-named service function in this slice, only what create/read/
update/remove needs internally. Followed identically here: `classRepository`'s
two secondary lookups stay unwrapped, deferred to whichever future
slice (the API layer) actually needs "find the class this logged-in
tutor owns" or "look up a class by its human-facing name" as a
standalone operation.

## Files likely affected
- `backend/src/services/academicService.js` (new)
- `backend/tests/academic-service.test.js` (new)

## Exact changes

**`academicService.js`** (mirrors `staffService.js`'s shape):
- Error classes: `ClassValidationError` (missing `className`),
  `ClassTimetableStatusError` (unknown `timetableStatus` literal),
  `ClassNameConflictError` (`classes_college_id_class_name_key`,
  23505), `ClassTutorConflictError` (`classes_tutor_user_id_key`,
  23505 — this tutor already tutors another class),
  `ClassTutorNotFoundError` (`classes_tutor_user_id_fkey`, 23503).
- `ALLOWED_FIELDS`: `className`, `department`, `semester`,
  `tutorUserId`, `timetableStatus`, `timetableData`,
  `timetableRemarks`. `collegeId` excluded (tenant set once at
  creation, matches `students`/`staff` precedent).
- `createClass(client, { collegeId, className, ...rest }, { actorUserId } = {})`
  — requires `className`, validates `timetableStatus` if supplied,
  maps the three constraint violations above, writes a
  `class_created` audit entry attributed to `actorUserId`.
- `getClass(client, id)` — thin passthrough, `null` means not found
  (not an error), same as `staffService.getStaff`.
- `updateClass(client, id, fields, { userId })` — partial update via
  `ALLOWED_FIELDS`, validates `timetableStatus` if supplied, maps
  `ClassNameConflictError`/`ClassTutorConflictError`/
  `ClassTutorNotFoundError` on conflict, audit entry only when
  something recognized actually changed and the id existed.
- `removeClass(client, id, { userId })` — looks the row up first (for
  `collegeId` on the audit entry and to skip logging a no-op), hard
  `DELETE`, audit entry only if a row existed.
- `listClasses(client, { limit, offset } = {})` — thin passthrough.

## Acceptance criteria
- `createClass` rejects a missing `className` and an unknown
  `timetableStatus` without calling the repository.
- `createClass` accepts all five known `timetableStatus` literals.
- Aadhaar-shaped/unrecognized fields are silently dropped, not passed
  to the repository or rejected with an error (matches
  `studentService.js`/`staffService.js`'s precedent).
- All three constraint violations (`classes_college_id_class_name_key`,
  `classes_tutor_user_id_key`, `classes_tutor_user_id_fkey`) map to
  their named domain errors on both create and update (name-conflict
  and tutor-conflict on update; FK-not-found only exercised on
  create, per `staffService.js`'s own test coverage precedent for
  update).
- A non-conflict repository error passes through unchanged (no
  swallowing).
- `updateClass`/`removeClass` write an audit entry only when a row
  actually changed/existed; no-op and not-found paths write nothing.
- No API route, UI, or workflow-transition logic in this slice —
  matches `staffService.js`'s own second-slice scope exactly.
