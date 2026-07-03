# TASK

## Objective
Module 1 (Student), first vertical slice: ERD + migration + repository only for the `students` table — no service/API/UI yet.

## Files likely affected
- `backend/migrations/1751700000000_module-1-student-schema.js` (new — next timestamp after `1751600000000_principal-invitations.js`)
- `backend/src/repositories/StudentRepository.js` (new)

## Exact changes

**ERD — `students` table** (tenant-scoped, RLS per BusinessRules Multi-tenancy):

- `id` UUID PK, default gen
- `college_id` TEXT NOT NULL, FK → `colleges(college_id)` — same type/convention as every other tenant table (`users`, `configurations`, etc.), not a new `tenants` table. RLS policy scoped on this, matching Module 0's `current_setting('app.current_tenant', true)` pattern exactly.
- `roll_no` TEXT NOT NULL
- `full_name` TEXT NOT NULL
- `gender` TEXT
- `entry_type` TEXT
- `emis_number` TEXT
- `umis_number` TEXT
- `email` TEXT
- `phone` TEXT
- `phone_verified` BOOLEAN DEFAULT false
- `parent_name` TEXT
- `parent_phone` TEXT
- `parent_phone_verified` BOOLEAN DEFAULT false
- `address` TEXT
- `pincode` TEXT
- `mark_10th` NUMERIC
- `mark_12th` NUMERIC
- `mark_iti` NUMERIC
- `accommodation` TEXT
- `club` TEXT
- `internship` TEXT
- `career_plan` TEXT
- `notes` TEXT
- `license_number` TEXT
- `bike_number` TEXT
- `created_at`, `updated_at` TIMESTAMPTZ

No Aadhaar field (CLAUDE.md rule 8, BusinessRules Students). No fields beyond `StudentEditorModal.jsx`'s documented list.

**Migration** (`node-pg-migrate`, reversible per CLAUDE.md rule 6):
- `up`: create `students` table as above, enable RLS, add tenant-isolation policy (Module 0 pattern), unique index on `(college_id, roll_no)` — closest identity field to BusinessRules' "register number" uniqueness rule, since `register_no`/`admission_no` aren't in the documented field list (flag this as an assumption to confirm, not a renamed field).
- `down`: drop table.

**Repository** (`StudentRepository.js`):
- CRUD only: `create`, `findById`, `findByRollNo`, `update`, `softDelete` (or hard delete if no soft-delete flag decided yet — flag as open question), `list` (tenant-scoped, paginated).
- No business logic, no validation beyond DB constraints — that's `StudentService`'s job (not this slice).
- Never calls another repository (CLAUDE.md rule 4).
- Raw SQL/query builder confined to this file only.

## Acceptance criteria
- Migration runs up and down cleanly against Module 0's schema.
- RLS policy present and matches Module 0's tenant-isolation pattern.
- `(college_id, roll_no)` uniqueness enforced at DB level.
- No Aadhaar column anywhere.
- Repository has zero references to Storage, other repositories, or Business Service logic.
- No service, API route, or UI code touched in this slice.
