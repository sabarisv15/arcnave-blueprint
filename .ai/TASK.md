# TASK

## Objective
Module 2 (Staff), first vertical slice: ERD + migration + repository
only for a `staff` table — no service/API/UI yet. Same discipline as
Module 1's first slice (`fbfd1c9`).

## Grounding (read before assuming any field list)
No `StaffEditorModal.jsx` equivalent exists, so this slice is grounded
against three real frontend files instead of one:
- `frontend/src/pages/FacultyRegister.jsx` — self-service registration
  form: `name, email, phone, dob, gender, department, designation,
  qualification, has_phd, address, college_code`.
- `frontend/src/pages/HodDashboard.jsx` and `PrincipalDashboard.jsx` —
  both have a working "Add/Edit Staff" modal (`staffForm`) posting to
  `/api/hod/staff`: `name, aicte_id, staff_id ("Staff ID (Biometric)"),
  joined_year, phone_number, department`. This modal, on submit,
  returns generated login credentials (`generatedCreds`) immediately —
  a real one-step provisioning flow.
- `FacultyRegister.jsx` posts to `/api/faculty/register`, which does
  **not exist anywhere in `backend/src`** (confirmed by grep) — same
  status as the Module 1 modal's fake "AI OCR" button: real UI, no
  working backend behind it. The HOD/Principal "Add Staff" flow is the
  only one grounded in working code.

## Key design decision: scope boundary against the registration chain
BusinessRules.md's Staff section describes a multi-step chain (Faculty
submits -> HOD approves -> Principal approves -> Staff ID generated ->
credentials emailed -> login enabled). Architecture.md assigns "all
approvals — staff activation..." to `WorkflowService`, which is
Module 8, not built yet.

This slice deliberately does **not** build a parallel approval-state
machine to stand in for `WorkflowService`. Reasoning: that would
preempt a design Module 8 hasn't made yet, the same trap the project
already avoids elsewhere (background jobs and API-doc generation are
both explicitly deferred in `Decisions-To-Revisit.md` until the module
that actually needs them exists, not guessed at early). It's also
consistent with what's actually grounded above: the only *working*
staff-creation flow in the frontend is the HOD/Principal direct-add
modal — one step, credentials generated immediately, no separate
pending-request state to persist.

Concretely: `staff` models the profile of an **already-provisioned**
staff member (a `users` row already exists — `user_id NOT NULL`). The
pre-account "submitted, awaiting HOD/Principal approval" state from
`FacultyRegister.jsx` has nowhere to live yet. Flagged as a real,
open gap for a later Staff slice or Module 8 to resolve — not decided
here, not silently dropped.

## Files likely affected
- `backend/migrations/1751900000000_module-2-staff-schema.js` (new —
  next timestamp after `1751800000000_module-1-marks-to-text.js`)
- `backend/src/repositories/staffRepository.js` (new)

## Exact changes

**ERD — `staff` table** (tenant-scoped, RLS per BusinessRules
Multi-tenancy, same pattern as `students`):

- `id` UUID PK, default gen
- `college_id` TEXT NOT NULL, FK -> `colleges(college_id)`
- `user_id` UUID NOT NULL UNIQUE, FK -> `users(id)` — 1:1 with the
  login account. `users` already owns `username`/`email`/
  `password_hash`/`role`/`is_active`/`activated_by`; `staff` does not
  duplicate any of those, it only holds profile fields `users` has no
  place for. (`students` has no `user_id` because students aren't
  login accounts in this schema — staff are, so this table's shape is
  genuinely different from `students`', not a copy-paste.)
- `staff_code` TEXT — the prototype's `staffForm.staff_id` ("Staff ID
  (Biometric)"), renamed here. Deliberate deviation, flagged rather
  than silently applied: naming it `staff_id` on a table already named
  `staff` collides with the FK-naming convention every other table in
  this codebase uses for a foreign key to `staff.id` (`students.id`/
  `college_id` pattern: FK columns are named `<table>_id`). Keeping
  the literal frontend name here would make every future
  `staff_id UUID REFERENCES staff(id)` column ambiguous with this
  free-text HR code. Same "document the deviation, don't just rename
  quietly" treatment BusinessRules.md itself uses for the Aadhaar
  case.
- `full_name` TEXT NOT NULL
- `gender` TEXT
- `dob` DATE
- `phone` TEXT — prototype has both `phone` (`FacultyRegister.jsx`)
  and `phone_number` (Hod/PrincipalDashboard `staffForm`) for the same
  concept. Picked `phone` to match `students.phone`'s existing
  column-naming convention. Flagged, not silently picked.
- `department` TEXT — freeform, no `departments` table. Both grounding
  files hardcode the department list client-side (no fetch from any
  department API), and nothing today needs department as a normalized
  entity with its own attributes. Inventing that table now would be
  structure nobody asked for yet (CLAUDE.md discipline) — revisit if
  Academic (Module 3, which owns curriculum-per-department) or a real
  multi-department requirement forces it.
- `designation` TEXT
- `qualification` TEXT
- `has_phd` BOOLEAN NOT NULL DEFAULT false
- `aicte_id` TEXT
- `joined_year` INT
- `address` TEXT
- `created_at`, `updated_at` TIMESTAMPTZ

No Aadhaar column (CLAUDE.md rule 8). No Class Tutor column: per
BusinessRules' "Resolved (Module 2 kickoff)" entry, tutor is an
assignment on a class/section record referencing a faculty user_id,
not a `staff` column — confirmed by the prototype's own working code
(`classesList.find(c => c.tutor_id === staff.username)`, keyed on
login username, not any staff-domain key). That assignment table
belongs to Academic (Module 3), not here.

**Migration** (`node-pg-migrate`, reversible per CLAUDE.md rule 6):
- `up`: create `staff` as above, enable + force RLS, tenant_isolation
  policy on `college_id` (identical pattern to the Module 1 migration
  — not reinvented), `UNIQUE (user_id)`, `UNIQUE (college_id,
  staff_code)`. Placeholder `GRANT SELECT, INSERT, UPDATE, DELETE` to
  `arcnave_app` — same "no soft-delete field decided yet" treatment
  `students`/`configurations` already got, not a new decision.
- `down`: drop table.

**Repository** (`staffRepository.js`, mirrors `studentRepository.js`'s
shape exactly — query mechanics only, no business logic, never calls
another repository per CLAUDE.md rule 4):
- `create(client, fields)`
- `findById(client, id)`
- `findByUserId(client, userId)` — the primary natural lookup (every
  staff profile is reached via "who is logged in," i.e. their
  `user_id`), same role `findByRollNo` played for students but keyed
  on the actually-unique, actually-populated-at-creation column.
- `findByStaffCode(client, collegeId, staffCode)` — secondary
  human-facing lookup, same `collegeId` + key filtering pattern as
  `findByRollNo`/`authRepository.getUserByUsername` (documents the
  real composite key rather than relying on RLS alone).
- `update(client, id, fields)` (partial, same entries-filter pattern
  as `studentRepository.update`)
- `remove(client, id)` (hard delete — no soft-delete column exists,
  same placeholder treatment as `students`)
- `list(client, { limit, offset })`

## Acceptance criteria
- Migration runs `up` and `down` cleanly against a DB that already has
  Module 0 (`users`/`colleges`) applied.
- RLS enabled + forced, `tenant_isolation` policy present, matches the
  `students`/Module 0 pattern exactly.
- `UNIQUE(user_id)` and `UNIQUE(college_id, staff_code)` both enforced
  at the DB level — prove with a real duplicate-insert failure for
  each, not just by reading the DDL.
- Inserting a `staff` row with a `user_id` that doesn't exist in
  `users` fails on the FK constraint — prove this, since it's the
  concrete enforcement of this slice's scope-boundary decision (no
  staff profile without a real account).
- No Aadhaar column anywhere.
- Repository has zero references to Storage, other repositories, or
  business-service logic.
- No service, API route, UI, or `ERD.md`/`docs/modules/` file touched
  in this slice — matches `fbfd1c9`'s actual scope (its `RESULT.md`
  changed only the migration + repository files, nothing docs-side),
  not the broader "ERD" wording taken literally as a doc edit.
