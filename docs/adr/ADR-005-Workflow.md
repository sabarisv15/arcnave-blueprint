# ADR-005: WorkflowService as the single approval engine

Status: Accepted

## Decision
All approvals in the system — human-initiated (staff activation, fee
changes) and AI-initiated (every Level 3 Act action) — route through
one `WorkflowService`, not separate mechanisms for each case.

## Alternatives considered
- **Separate approval path for AI actions**: rejected. Two approval
  systems means two places to get the permission model wrong, and no
  guarantee they stay in sync as rules evolve.

## Reasoning
An approval is an approval regardless of who or what proposed the
action. Unifying the mechanism means the "who can approve what"
question only needs to be answered once.

## Consequences
- `WorkflowRepository` persists approval requests and history for
  both origins.
- **Resolved (Module 8 implementation)**: approval authority does need
  one finer scope than RBAC roles alone — an actor may never approve a
  `workflow_requests` row whose `requested_by_user_id` is their own,
  regardless of origin (`human` or `ai`) or of otherwise being the
  resolved approver at the current step. Enforced in
  `workflowService.approveRequest` as a real, structural check
  (`WorkflowRequestSelfApprovalError`), not a UI-only convention.
  Scoped to approval only — `rejectRequest` allows self-withdrawal,
  since ending your own pending request early isn't a gate bypass.
  Verified live against both routed callers (Staff registration's
  Faculty→HOD→Principal chain, Finance's fee-structure approval): the
  resolved Principal cannot approve their own submission; a genuinely
  different Principal can. Commit `2021eec`.
