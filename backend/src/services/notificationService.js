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
async function submitForApproval(client, notificationId, { requestedByUserId } = {}) {
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

// Only callable once a notification is actually 'Approved'. Always
// attempts a real send (sendEmail — the only real channel today),
// always writes exactly one notification_delivery row recording
// whatever sendEmail actually returned, and always advances status to
// 'Dispatched' regardless of send outcome — see the file-level comment
// for why a failed send doesn't block that transition (best-effort
// delivery, same philosophy sendStaffCredentialsEmail's own caller
// already relies on).
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

  const sendResult = await sendEmail(client, {
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

module.exports = {
  NotificationValidationError,
  NotificationNotFoundError,
  NotificationUserNotFoundError,
  NotificationNoPendingRequestError,
  NotificationNotApprovedError,
  sendEmail,
  sendStaffCredentialsEmail,
  draftNotification,
  submitForApproval,
  approveNotification,
  rejectNotification,
  dispatchApprovedNotification,
};
