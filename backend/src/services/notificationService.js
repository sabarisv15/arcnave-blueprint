'use strict';

// Minimal first version of NotificationService (Module 8). Compose-
// only, no repository of its own — Architecture.md 2.5's own row for
// this service: "composes WorkflowService (approval) + DocumentService
// (templates) + external Email/SMS/WhatsApp providers. No repository
// of its own." This slice only ever needs the "external Email
// provider" half — no caller composes a WorkflowService approval or a
// DocumentService template into a notification yet, so neither is
// wired in here; adding them is a later slice's job, not guessed at
// now.
//
// BusinessRules.md's full lifecycle — every outbound notification is
// a row in `notifications` before it's sent (draft -> approved ->
// dispatched), with `notification_delivery` recording every attempt —
// is Architecture.md 2.8's own named future table pair, not built this
// slice (this session's own task is explicit: "no own repository").
// This version sends directly instead of queuing a draft for separate
// approval. That is deliberately narrower than BusinessRules.md's
// "Notifications that leave the system... always require human
// approval before dispatch... regardless of whether a human or the AI
// initiated the draft" — but not a silent skip of that rule: this
// version's only caller (staffService.approveStaffRegistration) only
// ever fires as the direct, deterministic consequence of a real human
// approval already recorded by WorkflowService (the Principal's own
// final sign-off on the registration chain) — there is no free-form or
// AI-drafted notification content this version could send without a
// human already in the loop. Once a caller needs to send something NOT
// already gated by a completed WorkflowService approval (an AI-drafted
// announcement, a bulk SMS blast, anything with actual discretionary
// content), it must NOT reuse sendEmail directly — it needs the real
// draft/approve/dispatch ledger this slice deliberately doesn't build,
// exactly the gap this comment flags for that future slice to close.
//
// One real channel: email, via nodemailer/SMTP (config.smtp.*, all
// optional — see config.js). No SMTP_HOST configured is the expected
// default in dev/test: sendEmail logs the message instead of
// attempting to send, so nothing here requires a real mail server to
// exercise, per this session's own explicit "stub/log-only fallback"
// instruction. A configured-but-failing send (bad credentials, network
// error) is also never fatal to the caller — delivery is logged as
// failed, not thrown, so a transient email problem can never roll back
// the real business action (staff activation) that triggered it. This
// mirrors BusinessRules.md's own eventual `notification_delivery`
// shape ("records every attempt... so delivery history is never lost,
// including retries") in spirit, even without that ledger existing
// yet — a failed send is a fact to record/retry later, not a reason to
// undo the approval that asked for it.

const nodemailer = require('nodemailer');
const config = require('../config');
const { logInfo, logWarn } = require('../logging/logger');

// Missing to/subject/body — the three things any email needs. Raised
// before touching nodemailer at all, same "guard first" shape every
// other service in this codebase uses.
class NotificationValidationError extends Error {}

// Built fresh per call, not cached: nodemailer.createTransport is a
// cheap, synchronous object construction (the real network connection
// only happens lazily inside sendMail itself), so there's no real cost
// to skipping a cache — and skipping it means config.smtp.host can
// change between calls (as it does across this file's own test suite,
// which exercises both the stubbed and configured paths) without a
// stale transporter object from a previous call silently surviving.
function getTransporter() {
  if (!config.smtp.host) {
    return null;
  }
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
}

// The one primitive this file offers: send a plain-text email, or log
// it as a stub if no SMTP provider is configured. Returns a status
// object rather than throwing on delivery failure — see the file-level
// comment for why. `client` (a DB transaction handle, unused here) is
// still the first parameter, matching every other service function in
// this codebase, even though this minimal version has no repository to
// call it with: a future slice adding the real notifications ledger
// (Architecture.md 2.8) needs it there without changing every call
// site that already threads it through.
// eslint-disable-next-line no-unused-vars
async function sendEmail(client, { to, subject, body }) {
  if (!to || !subject || !body) {
    throw new NotificationValidationError('to, subject, and body are required');
  }

  const transporter = getTransporter();
  if (transporter === null) {
    logWarn('notification_email_stubbed', { to, subject });
    return { channel: 'email', status: 'stubbed', to, subject };
  }

  try {
    await transporter.sendMail({ from: config.smtp.fromAddress, to, subject, text: body });
    logInfo('notification_email_sent', { to, subject });
    return { channel: 'email', status: 'sent', to, subject };
  } catch (err) {
    logWarn('notification_email_failed', { to, subject, error: err.message });
    return { channel: 'email', status: 'failed', to, subject, error: err.message };
  }
}

// The one composed notification this slice actually needs:
// BusinessRules.md's Staff registration chain, "credentials are
// emailed" — plainPassword is the exact, one-time value
// authService.activateUser just generated; nothing here stores it
// again, and the caller must not either.
async function sendStaffCredentialsEmail(client, { to, username, password, staffCode }) {
  const subject = 'Your ARCNAVE staff account is now active';
  const body = [
    'Your staff registration has been approved.',
    `Staff ID: ${staffCode}`,
    `Username: ${username}`,
    `Temporary password: ${password}`,
    '',
    'Please log in and change your password as soon as possible.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

module.exports = {
  NotificationValidationError,
  sendEmail,
  sendStaffCredentialsEmail,
};
