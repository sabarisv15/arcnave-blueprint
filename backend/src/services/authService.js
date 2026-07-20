'use strict';

// Business logic for tenant-side authentication: login, refresh-token
// rotation, revoke, activation (Module 8), and a not-implemented stub
// for password reset.
//
// Platform Admin login (platform_admins table) is a deliberately
// separate, not-yet-built concern — ADR-010 requires it never share
// auth or DB access with the tenant path. This module only ever
// touches users/refresh_tokens; it has no code path to
// platform_admins, and arcnave_app has no GRANT on that table
// regardless (see the ported migrations), so a tenant-scoped
// connection couldn't read it even if this module tried to.

const crypto = require('crypto');
const config = require('../config');
const security = require('../security');
const authRepository = require('../repositories/authRepository');
const principalInvitationRepository = require('../repositories/principalInvitationRepository');
const userMfaOtpRepository = require('../repositories/userMfaOtpRepository');
const notificationService = require('./notificationService');
const configurationService = require('./configurationService');
const auditLogRepository = require('../repositories/auditLogRepository');
const { logWarn } = require('../logging/logger');

// Generic authentication failure. Deliberately not more specific than
// this at the service boundary: unknown username, wrong password, and
// inactive account all raise the same thing, so the API layer can't
// accidentally return a response that reveals which of the three
// actually happened (that would leak which usernames exist / are
// pending activation).
class AuthError extends Error {}

// A refresh token that was already revoked was presented again.
// Distinct from AuthError even though the client-facing response is
// the same (401): this is a possible-theft signal, not a routine
// rejection, and refresh() logs it accordingly before raising.
class RefreshTokenReuseError extends Error {}

// activateUser given a userId with no matching row. Shouldn't happen
// in practice — every caller today (staffService.approveStaffRegistration)
// reaches this via staff.user_id, a real FK to users(id) — but this
// service makes no assumption about future callers, same "required
// lookup" precedent every other *NotFoundError in this codebase sets.
class UserNotFoundError extends Error {}

// resetPassword given no newPassword — the one thing this action
// cannot proceed without. Raised before any repository call, same as
// every other pre-query guard in this codebase.
class PasswordResetValidationError extends Error {}

// resetPassword given a token with no matching, unused, unexpired
// password_reset_tokens row. One generic message for all three cases
// (unknown/expired/already-used) — same don't-let-the-error-message-
// be-an-oracle reasoning as AuthError and /invitations/accept's own
// generic 401.
class PasswordResetTokenError extends Error {}

// verifyMfaLogin given a challengeId with no matching, unconsumed,
// unexpired user_mfa_otps row — never issued, already consumed, or
// naturally expired. Same generic-401 reasoning as AuthError: a caller
// gets no signal about which of the three actually happened.
class MfaChallengeNotFoundError extends Error {}

// verifyMfaLogin against a challenge that has already hit
// config.otp.maxAttempts mismatched codes — locked out; the caller
// must sign in again (login() always issues a fresh challenge).
class MfaMaxAttemptsExceededError extends Error {}

// verifyMfaLogin given a code that does not match the live challenge's
// hash — attempts is incremented before this throws, same as
// phoneVerificationService.verifyOtp.
class MfaCodeMismatchError extends Error {}

// lookupPendingInvitation given a token with no matching, unrevoked,
// unaccepted, unexpired principal_invitations row. One generic message
// for every case (unknown/revoked/already-accepted/expired) — same
// don't-let-the-error-message-be-an-oracle reasoning as AuthError/
// PasswordResetTokenError above; routes/invitations.js's own prior
// inline comments already established this, moved here unchanged.
class InvitationInvalidError extends Error {}

// acceptInvitation's createUser hit UNIQUE (college_id, username) —
// this username is already taken in the invitation's own college.
class InvitationUsernameConflictError extends Error {}

async function issueTokenPair(client, { collegeId, userId, role }) {
  const accessToken = security.createAccessToken({ userId, collegeId, role });
  const refreshToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenExpireDays * 24 * 60 * 60 * 1000);
  await authRepository.createRefreshToken(client, {
    collegeId,
    userId,
    tokenHash: security.hashRefreshToken(refreshToken),
    expiresAt,
  });
  return { accessToken, refreshToken, tokenType: 'bearer' };
}

// Business rule task #19 (BusinessRules.md Platform administration,
// "Authentication"): "MFA is configurable per institution (Disabled /
// Optional / Mandatory) and may be scoped to specific roles." Lives on
// the existing generic configurations store, category 'auth' — same
// mechanism every other per-tenant policy category already uses (see
// the 1756100000000 migration's own file-level comment for why this,
// unlike users.mfa_enabled, is NOT a real column). No row yet for a
// college is not an error — same "unset means the old, pre-MFA
// behavior" default DEFAULT_AI_PROVIDER already establishes for
// college_ai_config: mfaMode defaults to 'disabled', a real, deliberate
// college-admin action is what turns MFA on, never a change in
// behavior from before this feature existed.
const DEFAULT_AUTH_CONFIG = { mfaMode: 'disabled', mfaRoles: null };
const VALID_MFA_MODES = ['disabled', 'optional', 'mandatory'];

async function getAuthConfig(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: 'auth' });
  if (row === null || !row.configuration) {
    return DEFAULT_AUTH_CONFIG;
  }
  const { mfaMode, mfaRoles } = row.configuration;
  return {
    mfaMode: VALID_MFA_MODES.includes(mfaMode) ? mfaMode : DEFAULT_AUTH_CONFIG.mfaMode,
    mfaRoles: Array.isArray(mfaRoles) && mfaRoles.length > 0 ? mfaRoles : null,
  };
}

// mfaRoles === null means "not scoped to specific roles" — applies to
// every role, matching BusinessRules.md's "may be scoped" (optional
// narrowing, not a requirement to always name roles).
function roleInMfaScope(mfaRoles, role) {
  return mfaRoles === null || mfaRoles.includes(role);
}

function generateMfaCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashMfaCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Whether THIS user, on THIS login, must complete a second factor —
// 'mandatory' forces every in-scope user regardless of their own
// mfa_enabled flag; 'optional' only gates a user who has separately
// opted in via enableMfa (see below) — an institution turning Optional
// on changes nothing for a user who never opted in, same
// no-behavior-change-until-a-real-action default DEFAULT_AUTH_CONFIG's
// own comment establishes at the institution level.
function userRequiresMfa(authConfig, user) {
  if (!roleInMfaScope(authConfig.mfaRoles, user.role)) {
    return false;
  }
  if (authConfig.mfaMode === 'mandatory') {
    return true;
  }
  if (authConfig.mfaMode === 'optional') {
    return user.mfa_enabled === true;
  }
  return false;
}

// Issues a fresh MFA challenge for a password-verified user: generates
// a 6-digit code, stores its hash with a config.otp.expireMinutes
// expiry (the same institution-wide OTP window
// phoneVerificationService.js's student/parent flow uses — no separate
// MFA-specific window named anywhere in BusinessRules.md), and emails
// it. Returns the challenge row's id as the opaque routing handle the
// caller must echo back to verifyMfaLogin alongside the code itself —
// knowing this id alone never authenticates anyone; the code is the
// actual secret, and is rate-limited the same way phoneVerification's
// codes are (config.otp.maxAttempts).
async function issueMfaChallenge(client, user) {
  const code = generateMfaCode();
  const expiresAt = new Date(Date.now() + config.otp.expireMinutes * 60 * 1000);

  const challenge = await userMfaOtpRepository.create(client, {
    collegeId: user.college_id,
    userId: user.id,
    codeHash: hashMfaCode(code),
    expiresAt,
  });

  const sendResult = await notificationService.sendMfaCodeEmail(client, {
    to: user.email,
    code,
    expireMinutes: config.otp.expireMinutes,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: user.college_id,
    userId: user.id,
    action: 'mfa_challenge_issued',
    entity: 'user_mfa_otps',
    entityId: challenge.id,
    metadata: { deliveryStatus: sendResult.status },
  });

  return { mfaRequired: true, challengeId: challenge.id, expiresAt };
}

// The second half of an MFA-gated login: verifies the code against the
// challenge issueMfaChallenge minted, and on success issues the real
// token pair — the exact thing login() would have returned directly
// had MFA not been required. Same single-use/attempt-cap/expiry
// enforcement as phoneVerificationService.verifyOtp.
async function verifyMfaLogin(client, { challengeId, code }) {
  if (!challengeId || !code) {
    throw new MfaChallengeNotFoundError('challengeId and code are required');
  }

  const challenge = await userMfaOtpRepository.findById(client, challengeId);
  if (challenge === null || challenge.consumed_at !== null || challenge.expires_at.getTime() <= Date.now()) {
    throw new MfaChallengeNotFoundError('no live MFA challenge found for this id');
  }

  if (challenge.attempts >= config.otp.maxAttempts) {
    throw new MfaMaxAttemptsExceededError(`MFA challenge ${JSON.stringify(challenge.id)} has exceeded the maximum number of attempts`);
  }

  if (hashMfaCode(code) !== challenge.code_hash) {
    await userMfaOtpRepository.incrementAttempts(client, challenge.id);
    throw new MfaCodeMismatchError('code does not match');
  }

  await userMfaOtpRepository.markConsumed(client, challenge.id);

  const user = await authRepository.getUserById(client, challenge.user_id);
  if (!user || !user.is_active) {
    throw new AuthError('Account is not active');
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: user.college_id,
    userId: user.id,
    action: 'user_login',
    entity: 'users',
    entityId: user.id,
    metadata: { result: 'success', mfa: true },
  });

  return issueTokenPair(client, { collegeId: user.college_id, userId: user.id, role: user.role });
}

// Business rule task #19's self-opt-in half: meaningful only under
// institution mode 'optional' (see userRequiresMfa above) — enabling
// this under 'disabled' or 'mandatory' is harmless (a no-op and
// already-forced respectively) but never rejected here, since
// institution mode can change independently and a user's own
// preference should survive that.
async function enableMfa(client, userId) {
  const user = await authRepository.setMfaEnabled(client, userId, true);
  if (user === null) {
    throw new UserNotFoundError(`user ${JSON.stringify(userId)} does not exist`);
  }
  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: user.college_id,
    userId: user.id,
    action: 'mfa_enabled',
    entity: 'users',
    entityId: user.id,
    metadata: null,
  });
  return user;
}

async function disableMfa(client, userId) {
  const user = await authRepository.setMfaEnabled(client, userId, false);
  if (user === null) {
    throw new UserNotFoundError(`user ${JSON.stringify(userId)} does not exist`);
  }
  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: user.college_id,
    userId: user.id,
    action: 'mfa_disabled',
    entity: 'users',
    entityId: user.id,
    metadata: null,
  });
  return user;
}

// BusinessRules.md Central audit log: "login/logout" is named
// explicitly as a significant action to record — this codebase had no
// audit_log entry for either before this slice, success or failure.
// The failure branch is logged too (same "denial is a security-
// relevant event" reasoning aiToolRegistry.js's own 'ai_tool_denied'
// entries already establish for AI tool calls) with a coarse reason
// category, never the raw password or a client-facing detail that
// would turn the audit trail itself into the same username-enumeration
// oracle AuthError's own single generic message already avoids —
// audit_log is an internal record, not part of the login response.
async function login(client, { collegeId, username, password }) {
  const user = await authRepository.getUserByUsername(client, collegeId, username);

  let failureReason = null;
  if (!user) {
    failureReason = 'unknown_user';
  } else if (!(await security.verifyPassword(password, user.password_hash))) {
    failureReason = 'bad_password';
  } else if (!user.is_active) {
    failureReason = 'inactive_account';
  }

  if (failureReason !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId,
      userId: user ? user.id : null,
      action: 'user_login',
      entity: 'users',
      entityId: user ? user.id : null,
      metadata: { result: 'failure', reason: failureReason, username },
    });
    throw new AuthError('Invalid username or password');
  }

  if (await security.needsRehash(user.password_hash)) {
    await authRepository.updatePasswordHash(client, user.id, await security.hashPassword(password));
  }

  // Business rule task #19: a password match alone is not yet a
  // successful login for a user this institution's 'auth' config gates
  // into MFA — issueMfaChallenge below emails the second factor and
  // returns a challenge handle instead of tokens; the 'user_login'
  // success audit entry only fires once verifyMfaLogin actually
  // completes the sign-in (see that function above), same as this
  // branch's own entry below fires only for a login that is genuinely
  // complete.
  const authConfig = await getAuthConfig(client, user.college_id);
  if (userRequiresMfa(authConfig, user)) {
    return issueMfaChallenge(client, user);
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: user.college_id,
    userId: user.id,
    action: 'user_login',
    entity: 'users',
    entityId: user.id,
    metadata: { result: 'success' },
  });

  return issueTokenPair(client, { collegeId: user.college_id, userId: user.id, role: user.role });
}

async function refresh(client, rawRefreshToken) {
  const tokenHash = security.hashRefreshToken(rawRefreshToken || '');
  const stored = await authRepository.getRefreshTokenByHash(client, tokenHash);

  if (!stored) {
    throw new AuthError('Invalid refresh token');
  }

  if (stored.revoked_at !== null) {
    // logWarn here has no `req` available at all — authService only
    // ever receives `client`, deliberately (see this file's module
    // comment). requestId/collegeId still show up on this line
    // automatically via AsyncLocalStorage (logging/context.js), not
    // because anything here passed them explicitly — this is the real
    // call site tests/request-logging.test.js's concurrent-requests
    // test exists to prove, alongside the deliberately-delayed
    // test-only route.
    logWarn('refresh_token_reuse_detected', {
      collegeId: stored.college_id,
      userId: stored.user_id,
      refreshTokenId: stored.id,
      originallyRevokedAt: stored.revoked_at,
    });
    // A possible-theft signal, not a routine rejection — audited, not
    // just logged to the application log, same "a denial is a
    // security-relevant event" reasoning login's own failure path
    // above now follows.
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: stored.college_id,
      userId: stored.user_id,
      action: 'refresh_token_reuse_detected',
      entity: 'refresh_tokens',
      entityId: stored.id,
      metadata: { originallyRevokedAt: stored.revoked_at },
    });
    throw new RefreshTokenReuseError('Refresh token was already revoked');
  }

  if (stored.expires_at.getTime() <= Date.now()) {
    throw new AuthError('Refresh token has expired');
  }

  const user = await authRepository.getUserById(client, stored.user_id);
  if (!user || !user.is_active) {
    throw new AuthError('Account is not active');
  }

  await authRepository.revokeRefreshToken(client, stored.id);
  return issueTokenPair(client, { collegeId: user.college_id, userId: user.id, role: user.role });
}

// Logout. Idempotent and deliberately silent either way (no error for
// an unknown/already-revoked token) — the client's intent ("this
// token should stop working") is already satisfied.
async function revoke(client, rawRefreshToken) {
  const tokenHash = security.hashRefreshToken(rawRefreshToken || '');
  const stored = await authRepository.getRefreshTokenByHash(client, tokenHash);
  if (stored && stored.revoked_at === null) {
    await authRepository.revokeRefreshToken(client, stored.id);
    // BusinessRules.md Central audit log names "logout" explicitly.
    // Only logged for the real case (an active token actually
    // revoked) — the idempotent no-op for an unknown/already-revoked
    // token has nothing meaningful to record, same "no audit entry
    // for a no-op" convention removeStaff/removeFeeStructure/etc.
    // already establish elsewhere in this codebase.
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: stored.college_id,
      userId: stored.user_id,
      action: 'user_logout',
      entity: 'refresh_tokens',
      entityId: stored.id,
      metadata: null,
    });
  }
}

// Module 8: the reset-token flow the old Module 0 stub was waiting on.
// Enumeration-safe like login: whether or not a matching, active
// account exists for this email, the caller sees the same outcome (the
// route always 204s) — this function simply returns without emailing
// anything for an unknown email or an inactive account (nothing
// meaningful to reset — see authService.activateUser: an account with
// no real password yet isn't a legitimate reset target). Only a real
// match gets a token + email. collegeId is required, same as login:
// the caller must already have a resolved tenant (routes/auth.js runs
// this after tenantMiddleware, same as login).
async function requestPasswordReset(client, { collegeId, email }) {
  const user = await authRepository.getUserByEmail(client, collegeId, email);
  if (!user || !user.is_active) {
    return;
  }

  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.passwordResetTokenExpireHours * 60 * 60 * 1000);
  await authRepository.createPasswordResetToken(client, {
    collegeId,
    userId: user.id,
    tokenHash: security.hashRefreshToken(rawToken),
    expiresAt,
  });

  // The raw token is only ever handed to the user via this email —
  // never returned in an API response (this session's own task
  // instruction, same rule invitation tokens now follow — see
  // platformService.invitePrincipal).
  await notificationService.sendPasswordResetEmail(client, { to: user.email, token: rawToken });
}

// Consumes a reset token minted by requestPasswordReset above. Expired
// and already-used tokens are both rejected with the same generic
// PasswordResetTokenError — same pattern routes/invitations.js's
// accept flow already uses for its own one-time token.
const PASSWORD_COMPLEXITY_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

async function resetPassword(client, { token, newPassword }) {
  if (!newPassword) {
    throw new PasswordResetValidationError('newPassword is required');
  }

  const tokenHash = security.hashRefreshToken(token || '');
  const stored = await authRepository.getPasswordResetTokenByHash(client, tokenHash);

  if (!stored || stored.used_at !== null || stored.expires_at.getTime() <= Date.now()) {
    throw new PasswordResetTokenError('Invalid or expired password reset token');
  }

  if (!PASSWORD_COMPLEXITY_RE.test(newPassword)) {
    throw new PasswordResetValidationError(
      'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a symbol',
    );
  }

  await authRepository.updatePasswordHash(client, stored.user_id, await security.hashPassword(newPassword));
  await authRepository.markPasswordResetTokenUsed(client, stored.id);
}

// Module 8: the "login is enabled only once credentials exist" moment
// from BusinessRules.md's Staff registration chain. Generates a fresh
// temporary password (security.generateTemporaryPassword — never
// stored anywhere in plaintext except this one return value, used
// exactly once by the caller to compose a credential email), hashes
// it, and activates the user in one repository call. userId is always
// a staff.user_id in practice today (a real FK to users(id)), but this
// function doesn't assume that — any users row can be activated this
// way.
async function activateUser(client, userId, { activatedBy }) {
  const plainPassword = security.generateTemporaryPassword();
  const passwordHash = await security.hashPassword(plainPassword);
  const user = await authRepository.activateUser(client, userId, { passwordHash, activatedBy });
  if (user === null) {
    throw new UserNotFoundError(`user ${JSON.stringify(userId)} does not exist`);
  }
  return { user, plainPassword };
}

// BusinessRules.md Staff lifecycle: "staff accounts are deactivated,
// never deleted." A thin wrapper over authRepository.deactivateUser —
// users is AuthService's table, same "staffService calls authService
// for anything touching a users row" boundary activateUser's own
// comment already establishes.
async function deactivateUser(client, userId) {
  const user = await authRepository.deactivateUser(client, userId);
  if (user === null) {
    throw new UserNotFoundError(`user ${JSON.stringify(userId)} does not exist`);
  }
  return user;
}

// The pre-transaction half of accepting an invitation: resolves and
// validates the token BEFORE the caller knows which college_id to
// scope a real transaction to (routes/invitations.js's own module
// comment explains why that ordering is unavoidable here — this is
// the one route that can't rely on tenantMiddleware's normal
// resolution). client is a plain, un-scoped connection (a short-lived
// appPool.connect(), same as before) — principal_invitations has no
// RLS, so no tenant context is needed for this lookup at all.
async function lookupPendingInvitation(client, token) {
  const tokenHash = security.hashRefreshToken(token || '');
  const invitation = await principalInvitationRepository.getInvitationByTokenHash(client, tokenHash);

  if (invitation === null) {
    throw new InvitationInvalidError('invitation token does not exist');
  }
  if (invitation.revoked_at !== null) {
    throw new InvitationInvalidError(`invitation ${JSON.stringify(invitation.id)} was revoked`);
  }
  if (invitation.accepted_at !== null) {
    // Presenting an already-used one-time credential again is a
    // possible-theft signal, not a routine rejection — same asymmetry
    // refresh()'s own RefreshTokenReuseError has against a merely
    // expired-but-never-accepted token (which logs nothing).
    logWarn('principal_invitation_reuse_detected', {
      collegeId: invitation.college_id,
      invitationId: invitation.id,
      originallyAcceptedAt: invitation.accepted_at,
    });
    throw new InvitationInvalidError(`invitation ${JSON.stringify(invitation.id)} was already accepted`);
  }
  if (invitation.expires_at.getTime() <= Date.now()) {
    throw new InvitationInvalidError(`invitation ${JSON.stringify(invitation.id)} has expired`);
  }

  return invitation;
}

// The post-transaction half: client here IS the tenant-scoped
// transaction routes/invitations.js opens (via openTenantTransaction)
// against invitation.college_id once lookupPendingInvitation has
// already proven the token authentic. Every invitation accepted this
// way creates a 'principal' account — the only role this route has
// ever granted (see the migration's own file-level comment on
// principal_invitations' purpose).
async function acceptInvitation(client, invitation, { username, password }) {
  if (!PASSWORD_COMPLEXITY_RE.test(password || '')) {
    throw new PasswordResetValidationError(
      'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a symbol',
    );
  }

  let user;
  try {
    user = await authRepository.createUser(client, {
      collegeId: invitation.college_id,
      username,
      email: invitation.email,
      passwordHash: await security.hashPassword(password),
      role: 'principal',
      isActive: true,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new InvitationUsernameConflictError(`Username ${JSON.stringify(username)} is already taken`);
    }
    throw err;
  }

  await principalInvitationRepository.markInvitationAccepted(client, invitation.id);

  return user;
}

module.exports = {
  AuthError,
  RefreshTokenReuseError,
  UserNotFoundError,
  PasswordResetValidationError,
  PasswordResetTokenError,
  InvitationInvalidError,
  InvitationUsernameConflictError,
  MfaChallengeNotFoundError,
  MfaMaxAttemptsExceededError,
  MfaCodeMismatchError,
  login,
  refresh,
  revoke,
  requestPasswordReset,
  resetPassword,
  activateUser,
  deactivateUser,
  lookupPendingInvitation,
  acceptInvitation,
  verifyMfaLogin,
  enableMfa,
  disableMfa,
};
