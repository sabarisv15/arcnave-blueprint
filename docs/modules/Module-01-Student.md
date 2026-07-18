# Module 1 — Student Management

Status: Complete (migration → repository → service → API → UI, plus
one follow-up schema fix).

## Table
`students` — fields grounded directly against the real
`StudentEditorModal.jsx` (roll_no, full_name, gender, entry_type,
emis_number, umis_number, email, phone (+verified), parent_name,
parent_phone (+verified), address, pincode, mark_10th/12th/iti,
accommodation, club, internship, career_plan, notes, license_number,
bike_number). `UNIQUE(college_id, roll_no)` stands in for a
"register number" BusinessRules describes but never names a field for
— flagged assumption, not a silent rename. No Aadhaar column.

Follow-up fix (`9e527ea`): `mark_10th`/`mark_12th`/`mark_iti` changed
NUMERIC → TEXT — the real UI invites both "92%" and "460/500" input
conventions, neither of which NUMERIC can store losslessly, and no
business rule exists yet for which canonical form to collapse them to.

## Service
`studentService.js` — validation + audit logging over
`studentRepository.js` (CLAUDE.md rule 1). "Only the class tutor may
edit" (BusinessRules.md Staff) is left to the route/RBAC layer, not
enforced here — same split `configurationService.js` uses for its own
principal-only gate. No WorkflowService call (doesn't exist yet) —
BusinessRules' HOD-override exception for student-profile edits is a
named, deliberate gap.

## API
`backend/src/routes/students.js` — `/api/v1/students`.

## UI
`StudentEditorModal.jsx` repointed to the real API (`c9b6248`).

## Known gaps / deferred
- ~~`annual_income` field still missing~~ — **resolved**: column added
  (migration `1753500000000_student-annual-income.js`), threaded
  through `studentRepository.js`/`studentService.js`, and actually
  consumed by `financeService.js`'s real scholarship-eligibility calc
  (~line 504-519), not just a schema column nobody reads.
- BusinessRules' HOD-override exception on student-profile edits —
  needs WorkflowService (Module 8).

## Commits
`fbfd1c9` migration+repo · `5436460` service · `a562147` API ·
`c9b6248` UI · `9e527ea` marks NUMERIC→TEXT fix
