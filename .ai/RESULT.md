# RESULT

## Files changed
- `backend/src/services/workflowService.js` (new)

## What was built
`submitRequest` (validates required fields, `origin`, and
`approverChain` shape; maps `23505 workflow_requests_entity_pending_key`
/ `23503 ..._requested_by_user_id_fkey` to domain errors; audit-logs),
`approveRequest`/`rejectRequest` (load-and-validate against
`current_step`'s resolved approver, write to `approval_history` before
updating `workflow_requests`, then audit-log), `listPendingForApprover`
(thin wrapper over the already-live-proven repository call). Full
reasoning in the file's own header comment.

ADR-005's open question resolved: `approveRequest` throws
`WorkflowRequestSelfApprovalError` when `actorUserId === requested_by_user_id`
— checked live with a case where the requester genuinely *is* the
resolved step approver (single-step chain, requester = principal =
approver), not just the trivially-already-blocked step-mismatch case.
Scoped to approve only; `rejectRequest` allows a requester to withdraw
their own request (verified live).

## Verification
Live against the real docker-compose Postgres (one-off script, deleted
after use — no committed test file yet, same precedent as the first
slice): 19 assertions — full HOD→Principal 2-step approve flow
(wrong actor / requester rejected at each step, correct actor advances
then closes), single-step reject closes immediately, self-withdrawal
via reject allowed, ADR-005 self-approval rejected even when actor is
the real resolved approver, already-resolved re-action rejected,
malformed `approverChain`/bad `origin`/bogus FK all rejected with the
right domain error class, a new request allowed once a prior one for
the same entity resolves, `approval_history` + `audit_log` rows
correct, cross-tenant isolation holds through the service layer (0
rows visible to another tenant for the same `user_id`).

Full backend suite: 409/409 (one earlier run flaked at 408/409 with no
captured failing test name — reran clean twice after; not reproducible,
not related to this change, which added a new file only).

## Flags
- No API/UI yet, and no caller wired up — StaffService's registration
  chain and FinanceService's fee-structure approval gap still don't
  call in; that wiring is a later slice.
- Approver-chain *resolution* (who the HOD actually is) stays outside
  this service, per the first slice's own scoping.
