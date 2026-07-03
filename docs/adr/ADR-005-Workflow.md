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
- Open question, not yet resolved: whether approval authority needs
  finer scoping than existing RBAC roles (e.g. a staff member should
  not approve their own AI-drafted fee change) — to be settled during
  Module 8 (Workflow & Notifications) implementation.
