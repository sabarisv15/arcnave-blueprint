# RESULT

## Files changed
- `backend/package.json`, `backend/package-lock.json` (+`nodemailer`)
- `backend/src/config.js` (+`smtp` block, all optional)
- `.env.example`, `docker-compose.yml` (+`SMTP_*`, optional passthrough)
- `backend/src/security.js` (+`generateTemporaryPassword`)
- `backend/src/repositories/authRepository.js` (+`activateUser`)
- `backend/src/services/authService.js` (+`activateUser`, `UserNotFoundError`)
- `backend/src/services/notificationService.js` (new)
- `backend/src/services/staffService.js` (approval cascade)
- `backend/tests/notification-service.test.js`, `backend/tests/auth-service.test.js` (new)
- `backend/tests/staff-service.test.js` (+cascade tests)

## What was built
**Staff ID**: `staffService.assignStaffCode` — `STF-<year>-<6 hex>`,
retried on a real UNIQUE-constraint collision (no existing generation
pattern anywhere in this codebase to follow; checked `roll_no`/
`staff_code` first, both are caller-supplied).

**Activation**: `authRepository.activateUser` + `authService.activateUser`
— generates a fresh temporary password, hashes it, sets
`password_hash`/`is_active`/`activated_by` atomically, returns the
plaintext exactly once for the caller to email and never store again.

**NotificationService** (new, minimal): compose-only, no repository
(Architecture.md 2.5) — `sendEmail` (nodemailer/SMTP, `config.smtp.*`
optional, logs a stub if unconfigured, reports `failed` rather than
throwing on a real send error) and `sendStaffCredentialsEmail`. The
full ledger-backed lifecycle (`notifications`/`notification_delivery`,
Architecture.md 2.8) is explicitly not built — flagged in the file's
own comment, along with why this minimal direct-send version doesn't
violate BusinessRules.md's "always requires human approval before
dispatch": its only caller fires exclusively after a real, completed
WorkflowService approval.

**Wiring**: `staffService.approveStaffRegistration`'s terminal
`Approved` outcome now runs `assignStaffCode` → `authService.activateUser`
→ `notificationService.sendStaffCredentialsEmail` → an audit entry.
Non-terminal (mid-chain) resolutions return early, untouched. Returns
`{ workflowRequest, staff }` (enriched from the prior slice's bare
workflow-request return).

## Verification
Live against the real docker-compose Postgres (one-off script, deleted
after use; `app` image rebuilt for the new `nodemailer` dependency):
the HOD-only step leaves `staff_code`/`is_active`/`password_hash`
untouched; the Principal's terminal approval assigns a real
`staff_code`, flips `is_active`, attributes `activated_by` to the
approving principal, regenerates `password_hash` off its placeholder,
writes the `staff_activated` audit row, and — with SMTP unconfigured in
this environment — logs the real `notification_email_stubbed` line,
proving the whole cascade completes and commits without the
notification path ever blocking it. Acting again post-resolution
correctly rejects (`StaffRegistrationNotPendingError`).

Full backend suite: 430/430 (415 prior + 15 new: 5 NotificationService,
3 AuthService, 4 StaffService cascade, 2 net renames elsewhere already
covered in the prior slice's commit).

## Flags
- No API/UI for any of this yet.
- Who/what creates the *initial* `users` row a staff profile links to
  (before any registration chain starts) is still unbuilt — unchanged,
  still explicitly flagged, not this slice's job.
- NotificationService's real send path (a configured SMTP server) is
  unit-tested with a mocked transporter only — no real mail server
  exists in this dev environment to prove an actual outbound send;
  the stub/log fallback (the actual default in every environment today)
  is the one proven live.
