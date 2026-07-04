# RESULT

## Files changed
- `backend/migrations/1752900000000_module-8-workflow-schema.js` (new)
- `backend/src/repositories/workflowRepository.js` (new)
- `backend/src/repositories/approvalHistoryRepository.js` (new)
- `docs/modules/Module-08-Workflow-Notifications.md` (new)

## What was built
`workflow_requests` (requester, polymorphic entity, `origin`
human|ai, JSONB `approver_chain` + `current_step` + `status`) +
`approval_history` (append-only per-step ledger, own repository file
per ADR-018 — it names ApprovalHistory by name as a future ledger
candidate). Full reasoning in each file's own header comment; see
`docs/modules/Module-08-Workflow-Notifications.md` for the shape
summary.

## Verification
Live against the real docker-compose Postgres (one-off script, deleted
after use — same precedent as `326e8b5`/`31f5a8b`/`038f9e2`, no
committed test file at first-slice stage):
- RLS enabled+forced, tenant_isolation policy; cross-tenant isolation
  proven (0 rows visible to a second tenant).
- Full HOD→Principal 2-step chain exercised through `arcnave_app` with
  real `SET LOCAL`: `findPendingForApprover` correctly gated by
  `current_step` at each step.
- Partial unique index rejects a second concurrent `Pending` request
  for the same entity; a new one succeeds once the prior resolves.
- FK enforcement on `requested_by_user_id` (23503).
- DELETE rejected by Postgres itself on `workflow_requests` (42501);
  UPDATE rejected on `approval_history` (42501).
- Migration down/up reversibility confirmed.
- Full backend suite: 409/409 — required rebuilding the `app` Docker
  image first (stale since Module 7 added pdfkit/exceljs/docx as real
  deps, not yet in the built image).

## Flags
- No service/API/UI yet — next Module 8 slices.
- Approver-chain resolution (who is the HOD of a department) is
  explicitly not this table's job; the calling service resolves real
  `user_id`s before calling `create`.
- ADR-005's open self-approval question is still unresolved — a
  `WorkflowService` rule, not a schema one.
