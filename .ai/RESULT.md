# RESULT

## Files changed
- `backend/src/services/aiToolRegistry.js` (+`AiToolL3BypassError`,
  +`assertL3ResultNotBypassed`, `invokeTool` now checks it after any
  `L3` handler returns)
- `docs/modules/Module-09-AI.md` (Policy Gate section + Known Gaps
  updated — L3 safety now has a real runtime backstop, not only a
  documented convention)
- `backend/tests/ai-service.test.js` (+3 tests: the bypass backstop
  catches two distinct bad shapes; an `L1` tool with no
  `workflow_request_id` is correctly left alone; fixed 2 pre-existing
  tests whose dummy/mocked results didn't match the real DB row shape
  the new check expects)

No migration, no route change.

## What was built
`invokeTool` now runs `tool.handler(...)`, and for `L3` tools only,
asserts the result: `workflow_request_id` must be truthy, and `status`
must not be `'Dispatched'`/`'sent'`. Either violation throws
`AiToolL3BypassError` and writes an `ai_tool_denied` audit_log row
(`reason: 'l3_bypass'`), same pattern every other Policy Gate rejection
already uses. This runs strictly AFTER the handler executes — it
cannot undo a bad handler's already-happened side effects, only
guarantee they don't go undetected. `L1`/`L2` results are never
checked (a `workflow_request_id`-less result is completely normal for
them).

## Bugs caught by the new check itself, fixed before merging
The backstop immediately exposed two pre-existing test fixtures that
didn't reflect real shapes:
1. An earlier dummy `L3` test tool's handler returned `{ok: 'l3'}` —
   no `workflow_request_id`. Fixed to return a real submission-shaped
   result.
2. The real `request_notification_send` unit test's hand-written
   `notificationRepository.update` mock echoed back the camelCase
   `{workflowRequestId}` input instead of a real DB row's snake_case
   `workflow_request_id` (what `RETURNING *` actually returns) — the
   backstop correctly flagged this as indistinguishable from a bypass.
   Fixed the mock to match the real repository's return shape; this
   was a latent test-fidelity gap the new check surfaced, not a
   production bug.

## Verification
Full backend suite: **501/501**, both at `--test-concurrency=1` and at
default concurrency (the previously-flaky `reports.test.js`/
`documents.test.js` shared-directory race did not reproduce this run).

New tests: two deliberately-wrong dummy `L3` tools — one returning no
`workflow_request_id` at all, one returning a real
`workflow_request_id` alongside `status: 'Dispatched'` — are both
caught by `AiToolL3BypassError`, each with its own `ai_tool_denied` row
(`reason: 'l3_bypass'`). A dummy `L1` tool whose result also happens to
lack `workflow_request_id` runs normally, unflagged, proving the
backstop is `L3`-only. The real `request_notification_send` tool
(exercised by the pre-existing unit and integration tests, now fixed
to use accurate mock shapes) continues to pass the check as expected.

## Flags
- The backstop is a detection mechanism, not a prevention mechanism —
  documented prominently in both `aiToolRegistry.js` and
  `Module-09-AI.md`. A bad `L3` handler's real side effect (an actual
  send) would already have happened before this check runs; code
  review remains the only thing that prevents it.
- All flags from prior sessions unchanged.
