# TASK

## Objective (Module 8 — Workflow & Notifications — first slice)
ERD + migration + repository only. `workflow_requests` +
`approval_history`. No service/API/UI yet.

## Schema decisions
- `workflow_requests`: `entity_type`/`entity_id` polymorphic (staff
  registration, fee structure, future AI Act actions) — `entity_id` is
  a bare UUID, no FK (can't reference more than one table). `origin`
  ('human'|'ai') per ADR-005/AI-Governance: even AI-origin requests
  carry a real `requested_by_user_id` (AI-Governance.md line 63 — tool
  invocation is always tied to an authenticated user's session).
- Approver chain: `approver_chain` JSONB, an ordered array of
  `{step, role, user_id}` resolved by the calling service at creation
  time (e.g. StaffService resolves the actual HOD for the named
  department) — this slice only persists whatever chain it's given,
  doesn't resolve org structure. `current_step` + `status`
  ('Pending'|'Approved'|'Rejected') track overall progress, mirroring
  `fee_structures.status`'s no-CHECK convention.
- `approval_history`: append-only ledger (ADR-018 names this table by
  name as a future ledger-shaped candidate) — one row per actual
  approve/reject action taken at a step. Separate repository file from
  `workflow_requests`, same split reasoning as `audit_log` vs.
  `configurationRepository`.
- Partial unique index blocking two concurrent `Pending` requests for
  the same entity.

## Grounding
- BusinessRules.md Staff: Faculty→HOD→Principal chain — modeled as a
  2-step `approver_chain`, HOD resolved per the request's named
  department.
- `6957f02` (Finance fee-structure UI): confirmed `fee_structures`
  still has no `approved_by`/`approved_at` — this table is what will
  gate that transition later, not built here.
- Staff registration-approval gap: `staff` migration explicitly deferred
  the registration/approval chain to this module — confirmed via its
  file-level comment.

## Files
- `backend/migrations/1752900000000_module-8-workflow-schema.js` (new)
- `backend/src/repositories/workflowRepository.js` (new)
- `backend/src/repositories/approvalHistoryRepository.js` (new)
- `docs/modules/Module-08-Workflow-Notifications.md` (new)

## Verification
Live against docker-compose Postgres: migrate up, RLS + tenant
isolation, FK enforcement, partial unique index, every repository
function through `arcnave_app` with real `SET LOCAL`, migrate down/up
reversibility. No committed test file — same precedent as every prior
module's first slice (`326e8b5`, `31f5a8b`, `038f9e2`).
