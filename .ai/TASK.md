# TASK

## Objective (Module 8 — final scope, closes it end to end)
API + UI for the pending-approvals flow only — no new service logic.
Routes: `POST /api/v1/workflow-requests/:id/approve`, `:id/reject`,
`GET /api/v1/workflow-requests/pending`. UI: a "Pending Approvals"
list + approve/reject action in `HodDashboard.jsx` and
`PrincipalDashboard.jsx` (existing tab conventions, same pattern
`PrincipalDashboard`'s Fee Structures tab already uses). Wire
`StaffService.submitStaffRegistration` and
`FinanceService.submitFeeStructureApproval` to real UI trigger points
too (currently service-only, unreachable).

## Real design decision (not literally "workflowService only")
`workflowService.approveRequest`/`rejectRequest` alone only flip the
`workflow_requests` row. `staffService.approveStaffRegistration` and
`financeService.approveFeeStructure`/`rejectFeeStructure` each do real
work on top (fee structure status actually flipping; staff activation
cascade) that a bare passthrough would silently skip — a real
regression, not an acceptable simplification. Resolved (user's own
call, asked directly): the approve/reject route resolves the pending
request's `entity_type` first, then dispatches to the matching,
already-existing entity-specific function, falling back to
`workflowService` directly for anything else. No new service logic —
only routing between functions that already existed.

## Constraints
- Architecture.md 2.4 (API layer), CLAUDE.md rule 3 (WorkflowService
  is the sole approval gate).
- Submit routes gated `requireAuth`, not `requireRole('principal')`:
  gating to principal-only would deadlock the single-principal case
  against ADR-005's self-approval rule.

## Verification
Live: full backend suite + a real HTTP round-trip script (submit,
wrong-actor 403, step advance, terminal cascade, self-approval 403,
reject path) — then a real browser (headless Chrome via
`playwright-core`, scratch-installed for this one pass, real Vite dev
server + standalone backend) driven through the actual login flow and
UI, which is how the create-route-RBAC / ADR-005 self-approval
interaction was actually found.
