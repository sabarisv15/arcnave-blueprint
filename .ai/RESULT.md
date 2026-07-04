# RESULT

## Files changed
- `backend/src/repositories/staffRepository.js` (+`findByCollegeDepartmentAndRole`, `findByCollegeAndRole`)
- `backend/src/services/staffService.js` (+registration-chain wiring)
- `backend/src/services/financeService.js` (status lockdown + approval wiring)
- `backend/src/services/workflowService.js` (+`findPendingForEntity`, a pure read)
- `backend/src/routes/finance.js` (removed dead `FeeStructureStatusError` branch + `status` body mapping)
- `backend/tests/finance-service.test.js`, `backend/tests/finance.test.js` (updated for the new contract)

## What was built
**FinanceService**: `status` is no longer a caller-settable field on
`createFeeStructure`/`updateFeeStructure` at all — this is the actual
close of 6957f02's own named gap ("no status control... the one thing
that rule exists to prevent"). New `submitFeeStructureApproval`/
`approveFeeStructure`/`rejectFeeStructure` route the real transition
through `workflowService` (single-step chain, Principal only, resolved
from real `staff`+`users` data via `staffService.findPrincipal`).

**StaffService**: `findHodForDepartment`/`findPrincipal` resolve real
approver identities (two new JOIN queries in `staffRepository`, since
`staff` has no `role` column — it lives on `users`).
`submitStaffRegistration`/`approveStaffRegistration`/
`rejectStaffRegistration` build and drive a real 2-step
Faculty→HOD→Principal chain through `workflowService`. Credential/
activation generation on final approval stays an explicit, named,
unbuilt gap — not invented here.

**workflowService**: one addition, `findPendingForEntity` — a pure
read (no new validation/state-machine rule) letting callers correlate
their own entity id back to the governing `workflow_requests` row,
since neither `staff` nor `fee_structures` gained a
`workflow_request_id` column this slice.

## Verification
Live against the real docker-compose Postgres (one-off script, deleted
after use): real HOD/Principal resolution (a department with no HOD
correctly throws), full HOD→Principal registration chain (wrong actor
and self-approval both rejected at the right step), fee-structure
approval proving the actual point of this slice — the resolved
Principal cannot approve their own submission
(`WorkflowRequestSelfApprovalError`), a genuinely different Principal
can and the status becomes `Approved`, `rejectFeeStructure` closes to
`Rejected`, and a direct `status` write via `updateFeeStructure` is now
silently ignored (the original bypass, closed). `audit_log` rows
correct throughout.

Full backend suite: 415/415 (409 prior + 6 net new/replaced).

## Flags
- No new routes for the Finance/Staff approve/reject functions —
  still service-layer only, per this task's own scope.
- Turning an `Approved` staff registration into an active login
  (credentials/`users.is_active`) is still unbuilt — explicitly flagged
  in `staffService.js`, not invented here.
- `staffRepository`'s new HOD/Principal lookups pick the earliest-
  created matching row if more than one exists — nothing in the schema
  enforces at most one HOD per department or one Principal per
  college today.
