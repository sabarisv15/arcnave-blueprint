# Module 8 — Workflow & Notifications

Status: Complete for this build order's scope (schema, repositories,
WorkflowService, real FinanceService/StaffService callers, minimal
NotificationService, staff-approval → active login). No API/UI yet —
Module 9 (AI) can build against this; a real UI slice can follow
independently.

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

## Known gaps / deferred
- No API/UI for any of this yet.
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
Schema + repositories · `workflowService.js` · FinanceService/
StaffService wiring · NotificationService + staff-activation cascade
(this slice).
