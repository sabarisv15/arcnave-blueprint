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

const config = require('../config');
const security = require('../security');
const authRepository = require('../repositories/authRepository');
const principalInvitationRepository = require('../repositories/principalInvitationRepository');
const notificationService = require('./notificationService');
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

async function login(client, { collegeId, username, password }) {
  const user = await authRepository.getUserByUsername(client, collegeId, username);
  if (!user || !(await security.verifyPassword(password, user.password_hash)) || !user.is_active) {
    throw new AuthError('Invalid username or password');
  }

  if (await security.needsRehash(user.password_hash)) {
    await authRepository.updatePasswordHash(client, user.id, await security.hashPassword(password));
  }

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
async function resetPassword(client, { token, newPassword }) {
  if (!newPassword) {
    throw new PasswordResetValidationError('newPassword is required');
  }

  const tokenHash = security.hashRefreshToken(token || '');
  const stored = await authRepository.getPasswordResetTokenByHash(client, tokenHash);

  if (!stored || stored.used_at !== null || stored.expires_at.getTime() <= Date.now()) {
    throw new PasswordResetTokenError('Invalid or expired password reset token');
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
  login,
  refresh,
  revoke,
  requestPasswordReset,
  resetPassword,
  activateUser,
  lookupPendingInvitation,
  acceptInvitation,
};
