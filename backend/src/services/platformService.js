'use strict';

// Business logic for the Super Admin Portal API: platform-admin login,
// college creation, and principal invitation.
//
// invitePrincipal is Option B from Module-00-Platform.md's Known
// Limitations writeup (now resolved): this module records an
// invitation row and hands back a bearer token, but never writes to
// `users` itself — creating the actual account happens on the tenant
// side (see routes/invitations.js), through the normal RLS-protected
// tenant write path. arcnave_platform has no GRANT on
// users/refresh_tokens/audit_log/configurations (see the ported
// migrations) and gets none here either — only SELECT/INSERT/UPDATE
// on principal_invitations (0002 migration), so even a bug in this
// file could not reach tenant data.
//
// No per-request transaction wrapping here, unlike tenant routes —
// deliberately, not an oversight. Every operation in this pass is a
// single statement (one SELECT for login, one INSERT for college
// creation); Postgres autocommits a standalone statement with no
// explicit BEGIN, so there is no cross-statement atomicity requirement
// to protect the way tenant routes have one (set_config(...) and the
// query it scopes MUST share one transaction, or RLS fails closed on
// the very next statement — see tenant.js). Routes call these
// functions with `platformPool` directly, not a checked-out client;
// node-postgres's Pool exposes the same .query() interface, and
// letting the pool manage checkout/release per call is simpler than
// introducing a request-scoped transaction middleware this pass has
// no actual need for.

const config = require('../config');
const security = require('../security');
const platformRepository = require('../repositories/platformRepository');
const principalInvitationRepository = require('../repositories/principalInvitationRepository');
const platformCollegeRepository = require('../repositories/platformCollegeRepository');
const platformStatsRepository = require('../repositories/platformStatsRepository');
const platformAuditLogRepository = require('../repositories/platformAuditLogRepository');
const platformSettingsRepository = require('../repositories/platformSettingsRepository');
const platformAuditService = require('./platformAuditService');
const notificationService = require('./notificationService');

// Generic platform-admin authentication failure — same single-
// message-for-every-failure-mode reasoning as AuthError in
// authService.js: unknown username and wrong password must look
// identical to the caller.
class PlatformAuthError extends Error {}

// bootstrapPlatformAdmin given no username/email/password — the three
// things a platform_admins row needs. Raised before any repository
// call, same as every other pre-query guard in this codebase.
class PlatformAdminValidationError extends Error {}

// bootstrapPlatformAdmin called when a platform_admins row already
// exists — this session's own task: "a safe first platform-admin setup
// method that does not require manually inserting database data,"
// which by definition must stop working the moment a first admin is
// real, or it would just be an unauthenticated way to create more.
class PlatformAlreadyBootstrappedError extends Error {}

// college_id or subdomain already exists (colleges' two UNIQUE
// constraints).
class DuplicateCollegeError extends Error {}

// invitePrincipal's target college_id doesn't exist. Raised from a
// foreign_key_violation (23503) on the INSERT — principal_invitations
// has exactly one FK (college_id -> colleges), so any 23503 here
// unambiguously means this; no separate existence check needed,
// same reasoning as DuplicateCollegeError's unique_violation catch
// above.
class CollegeNotFoundError extends Error {}

// resendPrincipalInvitation/revokePrincipalInvitation given an
// invitationId with no matching row.
class PrincipalInvitationNotFoundError extends Error {}

// resendPrincipalInvitation/revokePrincipalInvitation given an
// invitation that's already accepted or already revoked — neither can
// be resent or revoked again. One error class for both sub-cases,
// same "the caller only needs to know this isn't actionable" reasoning
// workflowService.WorkflowRequestAlreadyResolvedError already uses for
// its own two terminal states.
class PrincipalInvitationNotPendingError extends Error {}

// This session's own task: "a safe first platform-admin setup method
// that does not require manually inserting database data." Safe means
// two things: (1) it can never create a SECOND admin once one exists —
// enforced at the DB level by platformRepository.bootstrapPlatformAdmin's
// atomic INSERT ... WHERE NOT EXISTS, not a check-then-insert this
// service could race against itself; (2) deliberately unauthenticated
// (there is no admin yet to authenticate as — the same structural
// reason /invitations/accept is this codebase's other unauthenticated
// tenant-side route), but that only stays safe because of (1): the
// window in which this route does anything at all is exactly "zero
// platform_admins rows exist," which in practice means once at
// first deploy.
//
// A minimum password length is enforced here — nowhere else in this
// codebase validates password strength (activateUser always generates
// its own random one), but every other credential-creation path is
// gated behind an existing authenticated actor; this is the one
// exception, so it gets its own floor.
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 8;

async function bootstrapPlatformAdmin(pool, { username, email, password }) {
  if (!username || !email || !password) {
    throw new PlatformAdminValidationError('username, email, and password are required');
  }
  if (password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    throw new PlatformAdminValidationError(`password must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters`);
  }

  const passwordHash = await security.hashPassword(password);
  const admin = await platformRepository.bootstrapPlatformAdmin(pool, { username, email, passwordHash });
  if (admin === null) {
    throw new PlatformAlreadyBootstrappedError('a platform admin already exists; bootstrap can only run once');
  }
  return admin;
}

async function login(pool, { username, password }) {
  const admin = await platformRepository.getPlatformAdminByUsername(pool, username);
  if (!admin || !(await security.verifyPassword(password, admin.password_hash))) {
    throw new PlatformAuthError('Invalid username or password');
  }
  const accessToken = security.createPlatformAccessToken({ adminId: admin.id });
  return { accessToken, tokenType: 'bearer' };
}

async function createCollege(pool, {
  collegeId, name, subdomain, createdBy, ipAddress,
}) {
  let college;
  try {
    college = await platformRepository.createCollege(pool, { collegeId, name, subdomain, createdBy });
  } catch (err) {
    // 23505 = unique_violation (Postgres SQLSTATE) — colleges has two
    // UNIQUE constraints (college_id, subdomain), either one failing
    // lands here. No need to distinguish which for the caller, same
    // as the deleted Python version's single DuplicateCollegeError
    // catching both.
    if (err.code === '23505') {
      throw new DuplicateCollegeError('college_id or subdomain already exists');
    }
    throw err;
  }

  await platformAuditService.record(pool, {
    actorAdminId: createdBy,
    action: 'college.created',
    entity: 'college',
    entityId: college.college_id,
    ipAddress,
    metadata: { name, subdomain },
  });

  return college;
}

// Records an invitation and emails the raw token to the invitee
// (notificationService.sendPrincipalInvitationEmail — NotificationService
// exists now, Module 8) — this session's own task instruction: an
// invitation token must never be returned in an API response, only
// delivered via the existing notification flow. The raw token is
// never persisted — only its hash, via security.js's existing
// generateRefreshToken/hashRefreshToken, reused verbatim rather than
// duplicated: an invitation token has the same threat-model shape as a
// refresh token (server-generated high-entropy randomness), so the
// same reasoning for SHA-256 over argon2 applies unchanged.
async function invitePrincipal(pool, {
  collegeId, email, createdBy, ipAddress,
}) {
  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.principalInvitationExpireHours * 60 * 60 * 1000);
  let invitation;
  try {
    invitation = await principalInvitationRepository.createInvitation(pool, {
      collegeId,
      email,
      tokenHash: security.hashRefreshToken(rawToken),
      createdBy,
      expiresAt,
    });
  } catch (err) {
    // 23503 = foreign_key_violation.
    if (err.code === '23503') {
      throw new CollegeNotFoundError(`No college with college_id ${JSON.stringify(collegeId)}`);
    }
    throw err;
  }

  await notificationService.sendPrincipalInvitationEmail(pool, {
    to: invitation.email,
    collegeId: invitation.college_id,
    token: rawToken,
    expiresAt: invitation.expires_at,
  });

  await platformAuditService.record(pool, {
    actorAdminId: createdBy,
    action: 'invitation.created',
    entity: 'principal_invitation',
    entityId: invitation.id,
    ipAddress,
    metadata: { collegeId: invitation.college_id, email: invitation.email },
  });

  return {
    invitationId: invitation.id,
    collegeId: invitation.college_id,
    email: invitation.email,
    expiresAt: invitation.expires_at,
  };
}

// Shared load+validate for resendPrincipalInvitation/
// revokePrincipalInvitation: the invitation must exist and must still
// be pending (never accepted, never revoked) — same "load then
// validate" shape financeService.loadPendingFeeStructureApproval
// already established for a different table.
async function loadPendingInvitation(pool, invitationId) {
  const invitation = await principalInvitationRepository.getInvitationById(pool, invitationId);
  if (invitation === null) {
    throw new PrincipalInvitationNotFoundError(`invitation ${JSON.stringify(invitationId)} does not exist`);
  }
  if (invitation.accepted_at !== null || invitation.revoked_at !== null) {
    throw new PrincipalInvitationNotPendingError(`invitation ${JSON.stringify(invitationId)} is no longer pending`);
  }
  return invitation;
}

// Rotates the invitation's token and expiry, then re-sends the email —
// the same row, not a new invitation, so accepting the OLD token (if
// it leaked, e.g. from a mis-delivered email) stops being possible the
// moment a fresh one is issued.
async function resendPrincipalInvitation(pool, invitationId, { actorAdminId, ipAddress } = {}) {
  const existing = await loadPendingInvitation(pool, invitationId);

  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.principalInvitationExpireHours * 60 * 60 * 1000);
  const invitation = await principalInvitationRepository.resendInvitation(pool, invitationId, {
    tokenHash: security.hashRefreshToken(rawToken),
    expiresAt,
  });
  if (invitation === null) {
    // Lost a race against a concurrent accept/revoke between the load
    // above and this update — re-check to report the real reason.
    throw new PrincipalInvitationNotPendingError(`invitation ${JSON.stringify(invitationId)} is no longer pending`);
  }

  await notificationService.sendPrincipalInvitationEmail(pool, {
    to: existing.email,
    collegeId: existing.college_id,
    token: rawToken,
    expiresAt: invitation.expires_at,
  });

  await platformAuditService.record(pool, {
    actorAdminId,
    action: 'invitation.resent',
    entity: 'principal_invitation',
    entityId: invitation.id,
    ipAddress,
    metadata: { collegeId: invitation.college_id, email: invitation.email },
  });

  return {
    invitationId: invitation.id,
    collegeId: invitation.college_id,
    email: invitation.email,
    expiresAt: invitation.expires_at,
  };
}

// No email on revoke — nothing to tell the invitee that isn't already
// implied by the token simply no longer working.
async function revokePrincipalInvitation(pool, invitationId, { actorAdminId, ipAddress } = {}) {
  await loadPendingInvitation(pool, invitationId);

  const invitation = await principalInvitationRepository.revokeInvitation(pool, invitationId);
  if (invitation === null) {
    throw new PrincipalInvitationNotPendingError(`invitation ${JSON.stringify(invitationId)} is no longer pending`);
  }

  await platformAuditService.record(pool, {
    actorAdminId,
    action: 'invitation.revoked',
    entity: 'principal_invitation',
    entityId: invitation.id,
    ipAddress,
    metadata: { collegeId: invitation.college_id, email: invitation.email },
  });

  return {
    invitationId: invitation.id,
    collegeId: invitation.college_id,
    email: invitation.email,
    revokedAt: invitation.revoked_at,
  };
}

// Platform Admin module build, Phase C — Organizations screen list.
async function listColleges(pool, { limit, offset, search } = {}) {
  return platformCollegeRepository.listColleges(pool, { limit, offset, search });
}

// Invitations screen list — principal-only, matching what this
// backend actually provisions from the platform level (see the plan's
// "Invitations: Principal-only" scoping decision).
async function listInvitations(pool, {
  limit, offset, status, search,
} = {}) {
  return principalInvitationRepository.listInvitations(pool, {
    limit, offset, status, search,
  });
}

async function listAuditLogs(pool, {
  limit, offset, action, actorAdminId, fromDate, toDate,
} = {}) {
  return platformAuditLogRepository.listEntries(pool, {
    limit, offset, action, actorAdminId, fromDate, toDate,
  });
}

async function getSettings(pool) {
  return platformSettingsRepository.getSettings(pool);
}

async function updateSettings(pool, {
  platformName, supportEmail, defaultTimezone, dateFormat, itemsPerPage, actorAdminId, ipAddress,
}) {
  if (!platformName) {
    throw new PlatformAdminValidationError('platformName is required');
  }

  const settings = await platformSettingsRepository.updateSettings(pool, {
    platformName, supportEmail, defaultTimezone, dateFormat, itemsPerPage,
  });

  await platformAuditService.record(pool, {
    actorAdminId,
    action: 'settings.updated',
    entity: 'platform_settings',
    entityId: null,
    ipAddress,
    metadata: { platformName, defaultTimezone, dateFormat, itemsPerPage },
  });

  return settings;
}

// Dashboard summary — composed from several small, focused queries
// (per-source repositories) rather than one large join, so each piece
// stays readable and independently testable, per the plan's own
// guidance for this endpoint.
async function getDashboardSummary(pool) {
  const [
    organizationsCount, pendingInvitationsCount, trialCollegesCount,
    activeUsersCount, recentColleges, recentActivity, systemHealth,
  ] = [
    await platformCollegeRepository.countColleges(pool),
    await principalInvitationRepository.countPending(pool),
    await platformCollegeRepository.countTrialColleges(pool),
    await platformStatsRepository.sumActiveUsers(pool),
    await platformCollegeRepository.recentColleges(pool, { limit: 5 }),
    await platformAuditLogRepository.listEntries(pool, { limit: 5 }),
    await platformStatsRepository.systemHealthSummary(pool),
  ];

  return {
    organizationsCount,
    pendingInvitationsCount,
    trialCollegesCount,
    activeUsersCount,
    recentColleges,
    recentActivity,
    systemHealth,
  };
}

module.exports = {
  PlatformAuthError,
  PlatformAdminValidationError,
  PlatformAlreadyBootstrappedError,
  DuplicateCollegeError,
  CollegeNotFoundError,
  PrincipalInvitationNotFoundError,
  PrincipalInvitationNotPendingError,
  bootstrapPlatformAdmin,
  login,
  createCollege,
  invitePrincipal,
  resendPrincipalInvitation,
  revokePrincipalInvitation,
  listColleges,
  listInvitations,
  listAuditLogs,
  getSettings,
  updateSettings,
  getDashboardSummary,
};
