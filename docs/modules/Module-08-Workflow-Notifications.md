# Module 8 — Workflow & Notifications

Status: **Complete, end to end** (schema, repositories, WorkflowService,
real FinanceService/StaffService callers, minimal NotificationService,
staff-approval → active login, and now the pending-approvals API + UI).
Module 9 (AI) can build against this.

## Tables
`workflow_requests` — the approval request itself: polymorphic
`entity_type`/`entity_id` (bare UUID, no FK — one column can't
reference more than one target table), `requested_by_user_id` (NOT
NULL even for `origin = 'ai'` — AI-Governance.md ties every AI action
back to the authenticated user whose session triggered it),
`approver_chain` (JSONB, ordered `{step, role, user_id}` array resolved
by the calling service at creation time, not by this table),
`current_step` + `status` (`Pending`/`Approved`/`Rejected`, no CHECK,
same convention as `fee_structures.status`). Partial unique index
blocks two concurrent `Pending` requests for the same entity.

`approval_history` — append-only ledger, one row per approve/reject
action (`step`, `actor_user_id`, `action`, `remarks`). ADR-018 names
this table by name as a future ledger-shaped candidate; own repository
file, same split `audit_log` already has from its callers.

Neither table is ever hard-deleted (GRANT omits DELETE on both).

## Repositories
`workflowRepository.js` — CRUD on `workflow_requests`, plus
`findPendingForApprover(client, userId)` (extracts the current step's
approver from `approver_chain` via a JSONB path expression) and
`findByEntity`. `approvalHistoryRepository.js` — `recordAction` +
`findByRequest`, SELECT/INSERT only.

## Verified live (docker-compose Postgres)
RLS enabled+forced, tenant_isolation policy, cross-tenant isolation
(0 rows visible to a second tenant). Full 2-step HOD→Principal chain
exercised through `arcnave_app` with real `SET LOCAL`:
`findPendingForApprover` correctly gated by `current_step`. Partial
unique index rejects a second concurrent `Pending` request for the
same entity, allows a new one once the prior resolves. FK enforcement
on `requested_by_user_id`. DELETE rejected by Postgres itself (42501)
on `workflow_requests`; UPDATE rejected (42501) on `approval_history`.
Migration down/up reversibility confirmed. Full 409/409 backend suite
passes (after rebuilding the `app` image, stale since Module 7 added
pdfkit/exceljs/docx).

## Service
`workflowService.js` — `submitRequest` (validates `origin`/
`approverChain` shape, maps FK/conflict errors, audit-logs),
`approveRequest`/`rejectRequest` (validate actor against
`current_step`'s resolved approver, write `approval_history` before
updating `workflow_requests`, audit-log), `listPendingForApprover`
(thin wrapper). ADR-005's open question resolved: `approveRequest`
throws `WorkflowRequestSelfApprovalError` when the actor is the
request's own `requested_by_user_id` — scoped to approve only;
`rejectRequest` allows self-withdrawal.

Verified live: full HOD→Principal 2-step chain (correct/wrong actor at
each step), single-step reject closes immediately, self-approval
rejected even when the actor is the genuinely-resolved step approver,
already-resolved re-action rejected, malformed input mapped to the
right domain error, cross-tenant isolation holds through the service
layer.

## Callers wired (third slice)
`workflowService` gained one pure read, `findPendingForEntity(client,
entityType, entityId)` — lets a caller correlate its own entity id
back to the governing `workflow_requests` row (neither `staff` nor
`fee_structures` stores a `workflow_request_id` column).

**FinanceService** (closes `6957f02`'s gap): `status` removed from
`FEE_STRUCTURE_ALLOWED_FIELDS` entirely — `createFeeStructure`/
`updateFeeStructure` can no longer set it directly. New
`submitFeeStructureApproval`/`approveFeeStructure`/`rejectFeeStructure`
route the real transition through `workflowService` (single-step
chain, Principal only, resolved from real data).

**StaffService**: `staffRepository` gained `findByCollegeDepartmentAndRole`/
`findByCollegeAndRole` (JOINs to `users` — `staff` has no `role` column
of its own). `findHodForDepartment`/`findPrincipal` wrap them (throw,
don't silently fall back, if nobody holds the role).
`submitStaffRegistration`/`approveStaffRegistration`/
`rejectStaffRegistration` build and drive a real 2-step
Faculty→HOD→Principal chain from that resolved data.

Verified live: real HOD/Principal resolution (no-HOD department
throws), full registration chain (wrong actor / self-approval rejected
at each step), fee-structure approval proving the actual point of this
slice — the resolved Principal cannot approve their own submission, a
genuinely different Principal can, and a direct `status` write via
`updateFeeStructure` is now silently ignored. Full suite: 415/415.

## Staff-approval → active login (final slice)
`approveStaffRegistration`'s terminal `Approved` outcome (never a
mid-chain step advance) now runs the rest of BusinessRules.md's own
sentence — "Staff ID is generated automatically -> credentials are
emailed -> login is enabled only once credentials exist":

1. `assignStaffCode` — `STF-<year>-<6 hex>`, retried on a real UNIQUE-
   constraint collision. No prior generation pattern existed anywhere
   in this codebase (`roll_no`/`staff_code` are both caller-supplied) —
   this is a fresh, minimal one.
2. `authService.activateUser` (new) — `users` is AuthService's table,
   not StaffService's. Generates a fresh temporary password
   (`security.generateTemporaryPassword`), hashes it, sets
   `password_hash`/`is_active`/`activated_by` in one statement, returns
   the plaintext exactly once.
3. `notificationService.sendStaffCredentialsEmail`.

## NotificationService (new, minimal — Architecture.md 2.5)
Compose-only, no repository of its own. One real channel: email via
`nodemailer`/SMTP, `config.smtp.*` all optional — unset `SMTP_HOST`
means `sendEmail` logs a stub instead of sending (the default, tested
path in every environment today). A configured-but-failing send is
caught and reported `status: 'failed'`, never thrown — delivery is
best-effort, never rolls back the staff activation that triggered it.

The full ledger-backed lifecycle (`notifications`/`notification_delivery`,
Architecture.md 2.8, BusinessRules.md's draft→approved→dispatched
model) is explicitly not built. This version sends directly instead —
defensible only because its one caller fires exclusively after a real,
already-completed WorkflowService approval (the Principal's own final
sign-off); there is no free-form/AI-drafted notification path yet for
it to gate separately. A future slice adding one must NOT reuse
`sendEmail` directly without that real ledger.

Verified live: the HOD-only step leaves `staff_code`/`is_active`/
`password_hash` untouched; the Principal's terminal approval assigns a
real `staff_code`, flips `is_active`, attributes `activated_by`,
regenerates `password_hash` off its placeholder, writes a
`staff_activated` audit row, and logs the real stub line with SMTP
unconfigured — the cascade completes and commits regardless of
notification delivery. Full suite: 430/430.

## API + UI (final slice) — closes Module 8 end to end
Three generic routes (`backend/src/routes/workflowRequests.js`), plus
two entity-specific submit routes previously built but unreachable:

- `GET /api/v1/workflow-requests/pending` — thin wrapper over
  `workflowService.listPendingForApprover`; `requireAuth`, not a role
  gate — the query itself is the authorization boundary (only rows
  where the caller is the resolved approver at the current step), same
  "the service is the gate" reasoning `attendance.js`'s router comment
  already gives for `AttendanceForbiddenError`.
- `POST /api/v1/workflow-requests/:id/approve` / `:id/reject` —
  **dispatch by `entity_type`, not a bare `workflowService` passthrough.**
  `workflowService.approveRequest`/`rejectRequest` alone only ever flip
  the `workflow_requests` row itself; `staffService.approveStaffRegistration`
  and `financeService.approveFeeStructure`/`rejectFeeStructure` each do
  real, load-bearing work on top of that (fee structure `status` actually
  flipping; staff_code assignment + user activation + credentials email).
  Calling `workflowService` directly for those two entity types would
  have flipped `workflow_requests.status` to `'Approved'` while leaving
  the fee structure stuck at `'Pending Approval'` forever and the staff
  member never activated — a real regression of Module 8's own earlier
  slices, not an acceptable simplification. The route resolves the
  pending request's own `entity_type` first (`workflowService.getRequest`,
  a new plain read added for exactly this) and dispatches to the
  matching, already-existing entity-specific function — no new service
  logic, only routing between functions that already existed. Anything
  outside `staff_registration`/`fee_structure` falls back to calling
  `workflowService` directly, so a future entity type with no dedicated
  cascade still works through this same endpoint.
- `POST /api/v1/staff/:id/submit-registration` /
  `POST /api/v1/finance/fee-structures/:id/submit-approval` — the
  actual trigger points for `submitStaffRegistration`/
  `submitFeeStructureApproval`, both built earlier in this module but
  never reachable from any route. **`requireAuth`, deliberately NOT
  `requireRole('principal')`** like every other write on `staff.js`/
  `finance.js`: BusinessRules.md names a real actor ("Faculty submits")
  unlike create/update's no-named-actor placeholder, and gating
  submission to principal-only would have broken the feature outright
  for the common single-principal case — `requestedByUserId` would
  equal the Principal's own `user_id`, which is also the resolved
  final-step approver in every chain (`findPrincipal`), so ADR-005's
  self-approval rule would reject every submission at the terminal
  step. `workflowService`'s own step-matching + self-approval checks
  are the real gate, not this route's RBAC.

**UI**: a "Pending Approvals" tab in both `HodDashboard.jsx` and
`PrincipalDashboard.jsx` (generic list, Approve/Reject buttons, same
card+list convention `PrincipalDashboard.jsx`'s existing Fee Structures
tab already uses) plus, on `PrincipalDashboard.jsx` only, a "Staff
Registrations" section (the `submitStaffRegistration` trigger) and a
"Submit for Approval" button added to the existing Fee Structures list
(the `submitFeeStructureApproval` trigger). Both use a NEW `realStaffList`
state (real `GET /api/v1/staff`), deliberately separate from the
existing, dead-endpoint `staffList` the legacy Staff Directory/Edit-Staff
modal on both dashboards still uses — that legacy flow is untouched,
same "don't half-repoint what wasn't asked" restraint this codebase
already applies elsewhere.

**A real, load-bearing interaction found live (browser click-through,
not by inspection), not fixed here**: staff/fee-structure `create` is
still gated `requireRole('principal')` (an unchanged, pre-existing
placeholder from Modules 2/5), and the Principal is always a resolved
approver in both chains (the terminal step for staff registrations, the
only step for fee structures). A Principal who both creates AND submits
the same record can never approve it themselves — ADR-005 correctly
403s the attempt, with a clear toast, not a silent failure or a crash.
Recoverable, not a dead end: `rejectRequest` has no self-check, so the
same Principal can withdraw their own mistaken submission and have a
different authenticated user submit instead (proven live: HOD approved
step 1, a re-submission by the Faculty member's own account reached
step 2, and Principal's terminal approval then succeeded — staff_code
assigned, `realStaffList` no longer showing that row as unregistered).
Fixing this for real means revisiting the create routes' RBAC
placeholder — out of this slice's "no new service logic" scope, flagged
in both `PrincipalDashboard.jsx`'s own comments and here.

Verified live: full backend suite 430/430 (no regressions); a
standalone backend (`PORT=5000`) + the real Vite dev server driven with
a headless Chrome instance (`playwright-core` against a locally
installed Chrome, scratch-installed for this one verification pass, not
added to this repo's dependencies) through the actual login flow
(college code → username/password) — submit as Faculty, approve as
HOD (step 1 of 2, list correctly moves from HOD's queue to Principal's),
approve as Principal (terminal: staff_code assigned, row disappears
from "Staff Registrations"), the self-approval 403 proven with its real
toast, and `console` free of runtime errors at every step.

## Known gaps / deferred
- No orchestration combining `submitStaffRegistration`/
  `submitFeeStructureApproval` and the create screens into one flow —
  a Principal must switch to the Pending Approvals tab to submit, a
  separate step from creating the record. Acceptable for this slice
  (create's own RBAC/UI is unchanged), not solved here.
- The create-route-RBAC / ADR-005 self-approval interaction described
  above — real, reproducible, recoverable via reject-and-resubmit, not
  fixed this slice.
- Who/what creates the *initial* `users` row a staff profile links to
  (before any registration chain starts) is still unbuilt — unchanged
  since the first Staff slice, still explicitly flagged.
- `staffRepository`'s HOD/Principal lookups pick the earliest-created
  matching row if more than one exists — nothing enforces at most one
  HOD per department or one Principal per college today.
- NotificationService's real SMTP send path is unit-tested with a
  mocked transporter only — no real mail server exists in this dev
  environment to prove an actual outbound send.
- The full notification ledger (`notifications`/`notification_delivery`)
  and any free-form/AI-drafted notification path are not built —
  the next thing to add once something other than staff activation
  needs to send a notification.

## Commits
`9e6787d` schema+repositories · `2021eec` `workflowService.js` ·
`45214b1` FinanceService/StaffService wiring · `de0f9a0`
NotificationService + staff-activation cascade · pending-approvals API
+ UI, closing Module 8 end to end (this slice).
