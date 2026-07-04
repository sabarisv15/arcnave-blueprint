# TASK

## Objective (Module 8 — Workflow & Notifications — third slice)
Wire real callers into `workflowService`. No new WorkflowService logic
(one pure read helper added, `findPendingForEntity` — see below).

## FinanceService (closes 6957f02's gap)
`status` removed from `FEE_STRUCTURE_ALLOWED_FIELDS` — create/update
can no longer set it directly at all (dead
`FeeStructureStatusError`/`VALID_FEE_STRUCTURE_STATUSES`/
`assertValidFeeStructureStatus` removed as unreachable). New:
`submitFeeStructureApproval` (single-step chain, Principal only —
nothing scopes a fee_structures row to one department the way Staff's
chain has an HOD step), `approveFeeStructure`/`rejectFeeStructure`
(load the row + its live Pending `workflow_requests` row, delegate to
`workflowService.approveRequest`/`rejectRequest`, then and only then
write `status` via `financeRepository.update`). `createFeeStructure`
itself is untouched — submission is a separate, explicit step, same
separation StaffService uses.

## StaffService (Faculty->HOD->Principal chain)
`staffRepository` gained two JOIN queries (`staff` has no `role` of
its own — it lives on `users`): `findByCollegeDepartmentAndRole`,
`findByCollegeAndRole`. `findHodForDepartment`/`findPrincipal` wrap
them (throw if nobody holds the role — a real gap, not a silent
fallback). `submitStaffRegistration` resolves both into a real 2-step
`approverChain`; `approveStaffRegistration`/`rejectStaffRegistration`
delegate to `workflowService`. Deliberately NOT built: turning
`Approved` into an actual active login (Staff ID/credentials/
`users.is_active`) — a separate, still-unbuilt capability per this
file's own prior comment, out of scope for "wire callers."

## workflowService
One addition: `findPendingForEntity(client, entityType, entityId)` — a
passthrough over `workflowRepository.findByEntity` filtered to the
single live Pending row (the partial unique index guarantees at most
one). Callers need this to correlate their own entity id back to a
workflow_requests id; documented as a pure read, not new approval
logic.

## Route fix (unavoidable consequence, not scope creep)
`finance.js`'s `mapFinanceServiceError` referenced the now-removed
`FeeStructureStatusError` — would have thrown `instanceof undefined`.
Removed that branch and the dead `status` body-field mapping. No new
routes added for the approve/reject functions — still service-layer
only.

## Grounding
`financeService.js`/`staffService.js`'s own file-level gap comments,
ADR-005, the two repo files as committed (`9e6787d`), `workflowService.js`
as committed (`2021eec`).

## Test fallout (mechanical, not scope creep)
`finance-service.test.js`/`finance.test.js`: the 3 tests asserting
direct-status validate/reject/accept behavior no longer apply (status
is now silently dropped, same as any unrecognized field) — replaced
with tests proving the drop; added mocked-workflowService/staffService
coverage for the 3 new Finance functions.

## Files
- `backend/src/repositories/staffRepository.js`
- `backend/src/services/staffService.js`
- `backend/src/services/financeService.js`
- `backend/src/services/workflowService.js`
- `backend/src/routes/finance.js`
- `backend/tests/finance-service.test.js`, `backend/tests/finance.test.js`

## Verification
Live against docker-compose Postgres (one-off script, deleted after
use): real HOD/Principal resolution from staff+users (no HOD ->
`StaffHodNotFoundError`), full 2-step Faculty->HOD->Principal
registration chain (wrong actor / self-approval rejected at each
step), fee-structure single-step chain including the ADR-005 case that
matters most — the resolved Principal cannot approve their own
submission, a genuinely different Principal can, `updateFeeStructure`
can no longer bypass the gate directly. Full backend suite: 415/415.
