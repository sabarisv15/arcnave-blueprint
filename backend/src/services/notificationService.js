'use strict';

// NotificationService (Module 8). Composes WorkflowService (approval)
// + external Email/SMS/WhatsApp providers, per Architecture.md 2.5.
// Two generations of behavior now coexist here, on purpose:
//
// 1. sendEmail/sendStaffCredentialsEmail — the original minimal slice.
//    UNCHANGED by this extension. sendStaffCredentialsEmail's only
//    caller (staffService.approveStaffRegistration) fires as the
//    direct, deterministic consequence of a real human approval
//    WorkflowService already recorded (the Principal's own final
//    sign-off on the registration chain) — there is no free-form or
//    AI-drafted content in that path for the new ledger below to gate,
//    so it is deliberately NOT retrofitted into it. Still send-first
//    (never a Draft row), still best-effort (a failed send never
//    throws, never rolls back the staff activation that triggered it).
//
// 2. draftNotification/submitForApproval/approveNotification/
//    rejectNotification/dispatchApprovedNotification — the real
//    `notifications`/`notification_delivery` ledger this file's
//    original comment flagged as a future gap (Architecture.md 2.8):
//    "every outbound notification is a row before it's sent... draft
//    -> approved -> dispatched." This is the path any FUTURE caller
//    with actual discretionary content (an AI-drafted announcement, a
//    bulk SMS blast, anything not already gated by a completed
//    approval) MUST use — never sendEmail directly. `notifications`
//    has no schema-level 'Pending' status (unlike workflow_requests):
//    "awaiting approval" lives entirely on the workflow_requests row a
//    Draft is submitted against (via workflow_request_id), so the two
//    tables can't drift out of sync on what counts as pending.
//    approveNotification/rejectNotification mirror
//    financeService.approveFeeStructure/rejectFeeStructure exactly —
//    status only ever moves off 'Draft' as the real consequence of
//    workflowService.approveRequest/rejectRequest actually resolving,
//    never a direct caller-supplied status write.
//
// One real channel: email, via nodemailer/SMTP (config.smtp.*, all
// optional — see config.js). No SMTP_HOST configured is the expected
// default in dev/test: sendEmail logs the message instead of
// attempting to send. A configured-but-failing send is also never
// fatal — delivery is recorded as failed (now a real
// notification_delivery row for the ledger path, still just a log
// line for the legacy sendStaffCredentialsEmail path), not thrown, so
// a transient email problem never blocks the caller. dispatchApprovedNotification
// applies that same "best-effort, never undo the approval" philosophy
// to the ledger: it always advances a notification to 'Dispatched'
// after attempting delivery, recording whatever sendEmail actually
// returned ('sent'/'stubbed'/'failed') in notification_delivery rather
// than blocking the status transition on send success — a failed send
// is a fact to record/retry later, not a reason to leave the
// already-approved notification stuck.

const nodemailer = require('nodemailer');
const twilioClient = require('../notificationProviders/twilioClient');
const config = require('../config');
const { logInfo, logWarn } = require('../logging/logger');
const notificationRepository = require('../repositories/notificationRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const workflowService = require('./workflowService');
// NOT required at the top level like every other dependency in this
// file: staffService.js itself requires notificationService.js (for
// sendStaffCredentialsEmail), so a top-level require here would be a
// genuine circular require. With this codebase's `module.exports =
// {...}` single-assignment convention (not incremental
// `module.exports.x = ...`), whichever of the two modules finishes
// loading second would capture the OTHER one's still-empty exports
// object — a real, load-order-dependent bug, not a style nitpick.
// Deferring this require to inside submitForApproval (the only
// function that needs it) means it always resolves after both modules
// have fully finished loading, since no code path calls it during
// either module's own top-level execution.

// Missing to/subject/body — the three things any email needs. Raised
// before touching nodemailer at all, same "guard first" shape every
// other service in this codebase uses. Also raised by draftNotification/
// submitForApproval given missing required fields — same class, same
// "guard before any work" reasoning, just a different set of required
// fields per caller.
class NotificationValidationError extends Error {}

// draftNotification/submitForApproval/approveNotification/
// rejectNotification/dispatchApprovedNotification given an id with no
// matching row — a required lookup, not an optional fetch, same
// precedent workflowService.WorkflowRequestNotFoundError/
// financeService.FeeStructureNotFoundError already set.
class NotificationNotFoundError extends Error {}

// notifications_drafted_by_user_id_fkey violated (Postgres 23503) —
// the given actorUserId doesn't exist.
class NotificationUserNotFoundError extends Error {}

// approveNotification/rejectNotification called for a notification
// with no live Pending workflow_requests row (never submitted for
// approval, or already resolved) — mirrors
// financeService.FeeStructureNoPendingRequestError exactly.
class NotificationNoPendingRequestError extends Error {}

// dispatchApprovedNotification called for a notification whose status
// isn't 'Approved' — still 'Draft' (never submitted, or submitted but
// not yet approved), already 'Dispatched' (blocks a double-send), or
// 'Rejected'. One check, one error class, regardless of which of those
// it actually is — a caller only needs to know "this isn't ready to
// dispatch," same reasoning workflowService.WorkflowRequestAlreadyResolvedError
// collapses "Approved" and "Rejected" into one rejection rather than
// enumerating every non-Pending status separately.
class NotificationNotApprovedError extends Error {}

// dispatchApprovedNotification called for a notification whose channel
// isn't in CHANNEL_SENDERS at all (not email/sms/whatsapp — every
// channel Architecture.md 2.8 names now has a real sender; this is
// only reachable for some other value, since notifications.channel
// has no CHECK constraint enforcing a known set at the DB level — see
// the migration's own comment). Thrown BEFORE any send attempt or
// repository write, never swallowed into a fake 'sent'/'stubbed'
// delivery row the way a real channel's best-effort philosophy works:
// there is no sender at all to have attempted anything with. The
// notification stays 'Approved' (never advances to 'Dispatched') — the
// same "leave it retriable, don't silently mark done" reasoning a
// failed real send already gets.
class NotificationChannelNotImplementedError extends Error {}

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

// Twilio SMS API (via notificationProviders/twilioClient.js — never
// the SDK directly here, so this stays mockable at the module-property
// boundary this codebase's tests already rely on). No
// TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER configured is the expected
// default in dev/test: sendSms logs the message instead of attempting
// to send (the exact same "would send: {...}" stub shape sendEmail
// already uses for an unconfigured SMTP_HOST — never a fake 'sent'
// status). Requires ALL three, not just credentials — a
// partially-configured account (e.g. accountSid/authToken set but
// fromNumber forgotten) is still "not configured," same as SMTP
// needing more than just a host. Once real config IS present, this
// always attempts a real send; a delivery failure is recorded as
// 'failed' (never thrown), same best-effort philosophy every other
// channel here already follows — dispatchApprovedNotification's own
// "always advance to Dispatched regardless of outcome" behavior is
// unchanged by adding a real provider.
async function sendSms(client, { to, body }) {
  if (!to || !body) {
    throw new NotificationValidationError('to and body are required');
  }

  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.fromNumber) {
    logWarn('notification_sms_stubbed', { to });
    return { channel: 'sms', status: 'stubbed', to, body };
  }

  try {
    const message = await twilioClient.sendMessage({
      accountSid: config.twilio.accountSid,
      authToken: config.twilio.authToken,
      to,
      from: config.twilio.fromNumber,
      body,
    });
    logInfo('notification_sms_sent', { to, sid: message.sid });
    return {
      channel: 'sms', status: 'sent', to, body, providerId: message.sid,
    };
  } catch (err) {
    logWarn('notification_sms_failed', { to, error: err.message });
    return {
      channel: 'sms', status: 'failed', to, body, error: err.message,
    };
  }
}

// Twilio WhatsApp API — the same underlying twilioClient.sendMessage
// call as sendSms, but both `from` and `to` need the `whatsapp:` scheme
// prefix Twilio's WhatsApp channel requires (a plain E.164 number
// there routes as SMS instead), and the sender identity is its own
// configured value (TWILIO_WHATSAPP_FROM), not TWILIO_FROM_NUMBER — a
// WhatsApp-enabled sender is provisioned separately from a plain SMS
// number, same reasoning this file already kept sendSms/sendWhatsapp
// as two functions rather than one shared "non-email" stub.
async function sendWhatsapp(client, { to, body }) {
  if (!to || !body) {
    throw new NotificationValidationError('to and body are required');
  }

  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.whatsappFrom) {
    logWarn('notification_whatsapp_stubbed', { to });
    return { channel: 'whatsapp', status: 'stubbed', to, body };
  }

  try {
    const message = await twilioClient.sendMessage({
      accountSid: config.twilio.accountSid,
      authToken: config.twilio.authToken,
      to: `whatsapp:${to}`,
      from: `whatsapp:${config.twilio.whatsappFrom}`,
      body,
    });
    logInfo('notification_whatsapp_sent', { to, sid: message.sid });
    return {
      channel: 'whatsapp', status: 'sent', to, body, providerId: message.sid,
    };
  } catch (err) {
    logWarn('notification_whatsapp_failed', { to, error: err.message });
    return {
      channel: 'whatsapp', status: 'failed', to, body, error: err.message,
    };
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

// This session's own task: password reset must go out through the
// existing notification flow, never in an API response. Same
// send-first, best-effort, non-ledger treatment as
// sendStaffCredentialsEmail above — a deterministic consequence of a
// real user action (their own reset request), no discretionary
// content for the ledger to gate.
async function sendPasswordResetEmail(client, { to, token }) {
  const subject = 'Reset your ARCNAVE password';
  const body = [
    'A password reset was requested for your ARCNAVE account.',
    `Reset token: ${token}`,
    '',
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

// This session's own task: principal invitation must go out through
// the existing notification flow, never in an API response. Same
// treatment as sendPasswordResetEmail above — the platform admin's own
// invite action is the deterministic trigger, not free-form/discretionary
// content. `client` here is realistically platformPool, not a tenant
// transaction (invitePrincipal has no tenant to scope one to yet — the
// college being invited into has no principal at all until this
// invitation is accepted) — harmless, since sendEmail never actually
// uses its own client parameter either (see that function's comment).
async function sendPrincipalInvitationEmail(client, {
  to, collegeId, token, expiresAt,
}) {
  const subject = `You've been invited to set up ARCNAVE for ${collegeId}`;
  const body = [
    `You have been invited to become the Principal administrator for college "${collegeId}" on ARCNAVE.`,
    `Invitation token: ${token}`,
    `This invitation expires at ${expiresAt.toISOString()}.`,
    '',
    'Use this token with POST /api/v1/invitations/accept to finish setting up your account.',
  ].join('\n');

  return sendEmail(client, { to, subject, body });
}

// origin has no DB CHECK constraint (see the migration's own file-level
// comment) — known values ('human'|'ai') enforced here, same house
// convention workflowService.assertValidOrigin already uses for the
// identical column on workflow_requests.
const VALID_ORIGINS = ['human', 'ai'];

function assertValidOrigin(origin) {
  if (!VALID_ORIGINS.includes(origin)) {
    throw new NotificationValidationError(`origin ${JSON.stringify(origin)} is not a known value`);
  }
}

// Creates a Draft row — no send, no approval request yet. subject is
// optional (not every future channel has one; email always supplies
// it in practice, but this function doesn't require it — see the
// migration's own file-level comment).
async function draftNotification(client, { collegeId, channel, toAddress, subject, body, origin = 'human' }, { actorUserId } = {}) {
  if (!collegeId || !channel || !toAddress || !body || !actorUserId) {
    throw new NotificationValidationError('collegeId, channel, toAddress, body, and actorUserId are required');
  }
  assertValidOrigin(origin);

  let notification;
  try {
    notification = await notificationRepository.create(client, {
      collegeId,
      channel,
      toAddress,
      subject: subject || null,
      body,
      status: 'Draft',
      origin,
      draftedByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'notifications_drafted_by_user_id_fkey') {
      throw new NotificationUserNotFoundError(`actorUserId ${JSON.stringify(actorUserId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'notification_drafted',
    entity: 'notifications',
    entityId: notification.id,
    metadata: null,
  });

  return notification;
}

// Submits an existing Draft for approval — resolves a single-step
// Principal-only approver chain (reused from staffService.findPrincipal,
// same precedent financeService.submitFeeStructureApproval already
// set: nothing in BusinessRules.md scopes a notification to one
// department, so there is no HOD to resolve here either), then stores
// the resulting workflow_requests id back onto the notification. Reuses
// the notification's OWN already-stored origin rather than accepting a
// second one — the two must always agree, so there is only ever one
// place origin is supplied.
//
// actionManifest is optional and simply forwarded to
// workflowService.submitRequest — this function has no opinion about
// its shape or contents (aiToolRegistry.js's request_notification_send
// handler is the one real caller that supplies one; the human REST
// route, routes/notifications.js, never does). Same "thin passthrough,
// not a second source of truth" reasoning this file already applies
// everywhere else.
async function submitForApproval(client, notificationId, { requestedByUserId, actionManifest } = {}) {
  if (!requestedByUserId) {
    throw new NotificationValidationError('requestedByUserId is required');
  }

  const notification = await notificationRepository.findById(client, notificationId);
  if (notification === null) {
    throw new NotificationNotFoundError(`notification ${JSON.stringify(notificationId)} does not exist`);
  }

  // Lazy require — see the file-level comment on why this can't be a
  // top-level require.
  const staffService = require('./staffService');
  const principal = await staffService.findPrincipal(client, notification.college_id);

  const request = await workflowService.submitRequest(client, {
    collegeId: notification.college_id,
    entityType: 'notification',
    entityId: notification.id,
    requestedByUserId,
    origin: notification.origin,
    approverChain: [{ step: 1, role: 'principal', user_id: principal.user_id }],
    actionManifest,
  });

  return notificationRepository.update(client, notificationId, { workflowRequestId: request.id });
}

// Shared load+validate for approveNotification/rejectNotification: the
// notification must exist, and exactly one live Pending workflow_requests
// row must govern it — same shape financeService.loadPendingFeeStructureApproval
// already established.
async function loadPendingNotificationApproval(client, notificationId) {
  const notification = await notificationRepository.findById(client, notificationId);
  if (notification === null) {
    throw new NotificationNotFoundError(`notification ${JSON.stringify(notificationId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'notification', notificationId);
  if (pending === null) {
    throw new NotificationNoPendingRequestError(`notification ${JSON.stringify(notificationId)} has no pending approval request`);
  }

  return { notification, pending };
}

// status only ever moves to 'Approved' as a consequence of a real
// workflowService.approveRequest resolution (ADR-005's self-approval
// rule, wrong-actor/wrong-step rejection, etc. all apply here exactly
// as they do for fee_structures) — never from a bare caller-supplied
// field. A single-step chain always resolves on this one call, same
// reasoning financeService.approveFeeStructure already gives for
// skipping a "still mid-chain" branch.
async function approveNotification(client, notificationId, { actorUserId, remarks } = {}) {
  const { pending } = await loadPendingNotificationApproval(client, notificationId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const notification = await notificationRepository.update(client, notificationId, { status: 'Approved' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: notification.college_id,
    userId: actorUserId,
    action: 'notification_approved',
    entity: 'notifications',
    entityId: notificationId,
    metadata: null,
  });

  return notification;
}

async function rejectNotification(client, notificationId, { actorUserId, remarks } = {}) {
  const { pending } = await loadPendingNotificationApproval(client, notificationId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  const notification = await notificationRepository.update(client, notificationId, { status: 'Rejected' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: notification.college_id,
    userId: actorUserId,
    action: 'notification_rejected',
    entity: 'notifications',
    entityId: notificationId,
    metadata: null,
  });

  return notification;
}

// channel -> sender function, keyed exactly on the values
// draftNotification actually accepts (no CHECK constraint on the
// column — see the migration's own comment — so this map, not the
// database, is what "a known channel" means). Deliberately NOT a
// fallback-to-email default for an unrecognized value: silently
// routing an sms/whatsapp notification through email would send it to
// whatever's in to_address as if it were an email address, which for
// a phone number is simply wrong, not a reasonable degradation.
const CHANNEL_SENDERS = {
  email: sendEmail,
  sms: sendSms,
  whatsapp: sendWhatsapp,
};

// Only callable once a notification is actually 'Approved'. Branches
// on the notification's own `channel` (CHANNEL_SENDERS above) — email/
// sms/whatsapp all now share the exact same best-effort philosophy:
// always attempt, always record whatever the sender returned
// ('sent'/'stubbed'/'failed'), always advance to 'Dispatched'
// regardless of outcome (same reasoning sendStaffCredentialsEmail's
// own caller already relies on for email). Only a genuinely
// unrecognized channel (not in CHANNEL_SENDERS at all) still throws
// NotificationChannelNotImplementedError BEFORE any
// notification_delivery row is written or status changes — see that
// error class's own comment for why that case is a thrown, visible
// failure rather than a recorded attempt: there is no real sender to
// have attempted anything with.
async function dispatchApprovedNotification(client, notificationId) {
  const notification = await notificationRepository.findById(client, notificationId);
  if (notification === null) {
    throw new NotificationNotFoundError(`notification ${JSON.stringify(notificationId)} does not exist`);
  }
  if (notification.status !== 'Approved') {
    throw new NotificationNotApprovedError(
      `notification ${JSON.stringify(notificationId)} is ${JSON.stringify(notification.status)}, not Approved`,
    );
  }

  const sender = CHANNEL_SENDERS[notification.channel];
  if (!sender) {
    throw new NotificationChannelNotImplementedError(
      `channel ${JSON.stringify(notification.channel)} has no dispatch implementation`,
    );
  }

  const sendResult = await sender(client, {
    to: notification.to_address,
    subject: notification.subject,
    body: notification.body,
  });

  const delivery = await notificationRepository.recordDeliveryAttempt(client, {
    collegeId: notification.college_id,
    notificationId: notification.id,
    status: sendResult.status,
    error: sendResult.error || null,
  });

  const updated = await notificationRepository.update(client, notificationId, { status: 'Dispatched' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: notification.college_id,
    userId: notification.drafted_by_user_id,
    action: 'notification_dispatched',
    entity: 'notifications',
    entityId: notificationId,
    metadata: { deliveryStatus: sendResult.status },
  });

  return { notification: updated, delivery };
}

// Thin passthrough to notificationRepository.list — the human-facing
// route this ledger never had (draft/submit/approve/reject/dispatch
// all existed; nothing to look at them with). Same "thin wrapper,
// concrete known consumer" reasoning attendanceService.
// listAttendanceSessionsForClassAndDate gives for its own passthrough,
// not speculative — routes/notifications.js is the real, immediate
// caller.
async function listNotifications(client, { limit, offset } = {}) {
  return notificationRepository.list(client, { limit, offset });
}

module.exports = {
  NotificationValidationError,
  NotificationNotFoundError,
  NotificationUserNotFoundError,
  NotificationNoPendingRequestError,
  NotificationNotApprovedError,
  NotificationChannelNotImplementedError,
  sendEmail,
  sendSms,
  sendWhatsapp,
  sendStaffCredentialsEmail,
  sendPasswordResetEmail,
  sendPrincipalInvitationEmail,
  draftNotification,
  submitForApproval,
  approveNotification,
  rejectNotification,
  dispatchApprovedNotification,
  listNotifications,
};
