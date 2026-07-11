# TASK

## Objective (Module 9 — L3 runtime backstop)
Add a runtime backstop in aiToolRegistry's invokeTool: after any L3
handler returns, assert the result has a workflow_request_id and no
Dispatched/sent status — throw AiToolL3BypassError if violated
(audit-log it too, same as other Policy Gate denials). Makes "L3 never
dispatches directly" a checked invariant, not just a documented
convention, per AI-Governance §1's "always required, no exceptions."

## Verification
Test: a deliberately-wrong L3 test tool that dispatches directly must
be caught and rejected, not silently allowed. Full suite, no
regressions.
