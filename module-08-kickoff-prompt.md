Start Module 8 (Workflow & Notifications) per Roadmap.md/ADR-005. Read
CLAUDE.md, Architecture.md 2.5/2.8, BusinessRules.md's Staff section
(approval chain), ADR-005 first.

First slice only: ERD + migration + repository. `workflow_requests`
(requester, approver chain, entity_type, entity_id, status, origin:
human|ai) + `approval_history`. Reversible, RLS per ADR-002 pattern
(check an existing migration for the exact policy shape). No service/
API/UI yet — that's later slices.

Ground the approver-chain shape against BusinessRules.md's Staff
registration chain (Faculty→HOD→Principal) and the two things already
waiting on this table: Finance's fee-structure approval gap (`6957f02`)
and Staff's registration-approval gap — don't guess the schema, check
those.

TASK.md->RESULT.md trimmed. Verify live before committing.
