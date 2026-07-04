# TASK

## Objective (Module 8 — Workflow & Notifications — second slice)
`workflowService.js` only. No API/UI. Repositories only, no raw SQL.

## Methods
- `submitRequest` — validates required fields + origin ('human'|'ai',
  no DB CHECK) + `approverChain` shape (sequential, 1-indexed,
  `{step, role, user_id}`, matching `workflowRepository`'s array-index
  JSONB lookup). Maps `23505 workflow_requests_entity_pending_key` /
  `23503 ..._requested_by_user_id_fkey` to domain errors. Audit-logs.
- `approveRequest` / `rejectRequest` — load the row (404-equivalent if
  missing, since approve/reject need the row's own `approver_chain`/
  `current_step` to validate against, not an optional fetch), reject
  if already resolved, validate `actorUserId` against
  `approver_chain[current_step - 1].user_id`. `approveRequest` also
  enforces **ADR-005's resolved open question**: actor cannot equal
  `requested_by_user_id` — scoped to approve only (rejecting your own
  request is a withdrawal, not a gate bypass). Approve advances
  `current_step` or closes to `'Approved'` on the final step; reject
  always closes to `'Rejected'` regardless of step. Both write to
  `approval_history` before the `workflow_requests` update, then
  audit-log.
- `listPendingForApprover` — thin wrapper over the already-live-proven
  `workflowRepository.findPendingForApprover`.

## Grounding
- ADR-005, CLAUDE.md rule 3, `workflowRepository.js`/
  `approvalHistoryRepository.js` as committed (`9e6787d`).
- `financeService.js` for house error-class/audit-log conventions;
  `attendanceService.js` for the "required lookup throws NotFound,
  optional fetch returns null" precedent used to decide
  `WorkflowRequestNotFoundError`'s shape.

## Files
- `backend/src/services/workflowService.js` (new)

## Verification
Live against docker-compose Postgres: full HOD->Principal 2-step
approve flow (correct actor advances/closes), self-approval rejected,
wrong-step actor rejected, reject closes early, already-resolved
re-action rejected, FK/conflict error mapping, cross-tenant isolation
still holds through the service layer. No committed test file yet —
same precedent as the first slice.
