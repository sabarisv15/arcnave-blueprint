# TASK

## Objective (Module 8 — Workflow & Notifications — final slice)
On `approveStaffRegistration`'s terminal `Approved` outcome: generate
Staff ID, activate the user, email credentials. Build NotificationService's
minimal first version to do the last part.

## Staff ID generation
No existing pattern to follow — checked `students.roll_no` and
`staff.staff_code` first (per this session's own instruction); both are
caller-supplied free text, never auto-generated anywhere in this
codebase. Fresh, minimal pattern: `STF-<year>-<6 hex chars>`, retried
on a real `staff_college_id_staff_code_key` collision (the existing
UNIQUE constraint is the actual backstop, not a pre-check) up to 5
attempts.

## Activation
`users` is AuthService's table (Architecture.md 2.5), not
StaffService's — new `authRepository.activateUser` +
`authService.activateUser(client, userId, {activatedBy})`: generates a
fresh temporary password (`security.generateTemporaryPassword`,
new), hashes it, sets `password_hash`/`is_active`/`activated_by` in one
statement, returns `{ user, plainPassword }` (the one and only place
the plaintext ever exists). A `users` row with some placeholder
password already exists by the time a `staff` profile does
(`staff.user_id`'s own FK) — this overwrites it with a real one at the
moment of approval, matching the old prototype's own `generatedCreds`
shape (checked `HodDashboard.jsx`/`PrincipalDashboard.jsx` — username +
a real password, shown/emailed at this exact step).

## NotificationService (new, minimal, per Architecture.md 2.5)
Compose-only, no repository of its own — the full `notifications`/
`notification_delivery` ledger (Architecture.md 2.8, BusinessRules.md's
draft→approved→dispatched lifecycle) is a later slice, not built here.
One real channel (email, via `nodemailer`, new dependency), `config.smtp.*`
all optional — unset `SMTP_HOST` means `sendEmail` logs a stub instead
of sending (this session's own explicit instruction). A configured-but-
failing send is caught and reported `status: 'failed'`, never thrown —
delivery is best-effort, never rolls back the real business action
that triggered it.

**BusinessRules.md's "always requires human approval before dispatch"**:
this minimal version's only caller fires exclusively as the direct
consequence of a real, already-completed WorkflowService approval (the
Principal's own final sign-off) — there is no free-form/AI-drafted
notification path yet for it to gate separately. Flagged explicitly in
the file's own comment: a future free-form/AI-drafted notification
must NOT reuse `sendEmail` directly without the real draft/approve/
dispatch ledger.

## Wiring (staffService.js)
`approveStaffRegistration` now: resolves the pending request via
`workflowService.approveRequest` (unchanged) → if `status !== 'Approved'`
(still mid-chain, e.g. just the HOD's step), returns early, no cascade
→ on terminal `Approved`: `assignStaffCode` → `authService.activateUser`
→ `notificationService.sendStaffCredentialsEmail` → an audit entry
(`staff_activated`). Returns `{ workflowRequest, staff }` (enriched
from the prior slice's bare workflow-request return — no committed
test depended on the old shape).

## Files
- `backend/package.json` (+`nodemailer`)
- `backend/src/config.js` (+`smtp` block, optional)
- `.env.example`, `docker-compose.yml` (+SMTP_* vars, optional)
- `backend/src/security.js` (+`generateTemporaryPassword`)
- `backend/src/repositories/authRepository.js` (+`activateUser`)
- `backend/src/services/authService.js` (+`activateUser`, `UserNotFoundError`)
- `backend/src/services/notificationService.js` (new)
- `backend/src/services/staffService.js` (cascade wiring)
- `backend/tests/notification-service.test.js`, `auth-service.test.js` (new)
- `backend/tests/staff-service.test.js` (+cascade coverage)

## Verification
Live against docker-compose Postgres (one-off script, deleted after
use, image rebuilt for `nodemailer`): HOD-only step leaves
`staff_code`/`is_active`/`password_hash` untouched; Principal's
terminal approval assigns a real `staff_code`, flips `is_active`,
attributes `activated_by`, regenerates `password_hash` off the
placeholder, writes the `staff_activated` audit row, and (SMTP
unconfigured in this environment) logs the real stub line — proving
the cascade completes and commits without the notification path ever
blocking it. Acting again post-resolution correctly rejects. Full
backend suite: 430/430 (415 prior + 15 new unit tests).
