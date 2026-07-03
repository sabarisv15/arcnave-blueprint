# RESULT

## Files changed
- backend/src/services/studentService.js (new)
- backend/tests/student-service.test.js (new)
- backend/src/repositories/studentRepository.js (bug fix, found while testing this slice)

## What changed, per file
- `studentService.js`: `createStudent`, `getStudent`, `updateStudent`,
  `removeStudent`, `listStudents`. `StudentValidationError` (missing
  `rollNo`/`fullName`) and `StudentRollNoConflictError` (Postgres `23505` on
  `students_college_id_roll_no_key`, caught and rethrown as a domain error —
  no raw pg error ever reaches the caller). Every function takes `client`
  first; `createStudent` takes `collegeId` explicitly (defense in depth,
  matching `authService.js`); `updateStudent`/`removeStudent`/`getStudent`
  don't (id is globally unique, same convention as `authRepository.js`'s
  id-keyed lookups). A module-level `ALLOWED_FIELDS` whitelist (mirrors, but
  deliberately duplicates rather than imports, `studentRepository.js`'s
  column list) is the thing that actually keeps an aadhaar-shaped field from
  ever reaching the DB — picked over throwing on unknown fields since aadhaar
  gets no special treatment beyond what any other unrecognized/typo'd field
  already gets. Calls only `studentRepository` and `auditLogRepository` — no
  other repository, no Storage, no WorkflowService. No RBAC/authorization
  logic (left to the future route/RBAC layer, per the task).
- `student-service.test.js`: unit tests for every path that needs no DB —
  missing-field validation, aadhaar-drop, 23505→domain-error mapping,
  non-23505 passthrough, and the "audit entry only if a row actually
  changed" logic for update/remove. `studentRepository`/`auditLogRepository`
  are stubbed via `node:test`'s built-in `t.mock.method`.
- `studentRepository.js`: fixed a bug this slice's testing surfaced —
  `create` was inserting an explicit `NULL` for every field the caller
  omitted, which violated `phone_verified`/`parent_phone_verified`'s
  `NOT NULL DEFAULT false` the moment a caller didn't pass them (i.e. every
  normal `createStudent` call). Now filters to only the provided columns
  before building the `INSERT`, same pattern `update()` already used, so
  Postgres applies its own `DEFAULT` for anything omitted. Out of this
  task's stated file list, but the vertical slice didn't actually work
  without it.

## Tests
1. **Unit (no DB)** — `node --test tests/student-service.test.js`: 11/11
   pass. Covers missing `rollNo`, missing `fullName`, aadhaar-field drop,
   `23505` → `StudentRollNoConflictError`, a non-`23505` error passing
   through unchanged, update-with-no-recognized-fields skipping the audit
   entry, update-against-a-nonexistent-id skipping it, and remove's
   found/not-found audit behavior.
2. **Duplicate-roll-no path (live DB)** — spun up a throwaway `postgres:16`
   container, created the `arcnave_app`/`arcnave_platform` roles, ran all
   three migrations, then called `studentService.createStudent` twice
   through a real `arcnave_app` connection with `SET app.current_tenant`
   set, same `(collegeId, rollNo)` both times. First call succeeded; second
   raised `StudentRollNoConflictError` from a genuine Postgres `23505`
   (not a simulated one); confirmed exactly one `student_created` audit row
   exists (the failed second attempt never reached the audit-log call).
   Container removed after.
3. `node --check` on both `studentService.js` and `studentRepository.js` —
   clean.

## Flags / open questions
- **Repository bug fix was out of scope for this task's file list** —
  `studentRepository.js` wasn't supposed to change this slice, but
  `createStudent` couldn't actually create a student without it (see
  above). Flagging in case this should've been a separate fix/commit
  instead of bundled in.
- **Audit-logging on writes is still an assumption, not a confirmed
  requirement** — carried forward from the task itself: BusinessRules.md
  doesn't explicitly mandate an audit entry for student create/update/
  remove; this follows `configurationService.setConfiguration`'s existing
  house convention, not a stated rule.
- **Aadhaar handling: silent drop, not rejection** — a caller sending an
  aadhaar-shaped field gets no error; the field is simply absent from what
  reaches `studentRepository`. Picked because every other unrecognized
  field gets the same treatment; happy to switch to a loud rejection
  specifically for aadhaar-named keys if that's preferred.
- **Soft delete still unresolved** — `removeStudent` is still a hard
  `DELETE` (via `studentRepository.remove`), unchanged from the first
  slice's open question.
- **`removeStudent` looks up the row before deleting** — not explicitly
  asked for, but needed to get `collegeId` for the audit entry (the task's
  given signature takes no `collegeId`) and to avoid writing a
  `student_removed` audit entry for an id that never existed. Flagging as
  a small addition beyond a literal passthrough.
