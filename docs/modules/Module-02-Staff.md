# Module 2 — Staff Management

Status: Complete (migration → repository → service → API → UI).

## Table
`staff` — profile fields only (`user_id` FK to `users`; login fields
username/email/password_hash/role/is_active stay on `users`, not
duplicated). `staff_code`, not `staff_id`, to avoid colliding with the
`staff_id UUID REFERENCES staff(id)` FK convention other tables use.
No Class Tutor column — tutor is a `classes`/faculty-allocation
assignment (Module 3), not a staff attribute. No Aadhaar column.

## Service
`staffService.js` — validation + audit logging over `staffRepository.js`
(CLAUDE.md rule 1). Assumes a `userId` for an already-provisioned
`users` row is handed in; does not create accounts or run the
Faculty→HOD→Principal approval chain described in BusinessRules.md —
that's WorkflowService (Module 8), deliberately unbuilt, not stubbed.

## API
`backend/src/routes/staff.js` — `/api/v1/staff` CRUD.

## UI
Add/Edit Staff modal repointed to the real API (`49c2c36`).

## Known gaps / deferred
- ~~Staff registration/approval workflow — Module 8.~~ — **resolved**:
  `staffService.js`'s `approveStaffRegistration`/`rejectStaffRegistration`
  call real `workflowService.approveRequest`/`rejectRequest` (submitted
  via `workflowService.submitRequest`), not a placeholder.
- ~~Credential generation/emailing on approval — Module 8.~~ —
  **resolved**: `approveStaffRegistration` generates a temporary
  password via `authService.activateUser` and hands off to
  `notificationService` for the credential email.

## Commits
`31f5a8b` migration+repo · `86fa63b` service · `8333dec` API ·
`49c2c36` UI
