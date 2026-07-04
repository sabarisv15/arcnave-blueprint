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

// Stub — Roadmap.md lists password reset in Module 0 scope, but it
// needs a reset-token flow that doesn't exist yet. notificationService
// exists now (Module 8), but only for its one built use (staff
// activation) — reusing it here without a real reset-token mechanism
// would just email a password nobody asked to change. Throwing here is
// the whole implementation; the route layer turns this into 501.
// eslint-disable-next-line no-unused-vars
function requestPasswordReset(email) {
  throw new Error('Password reset is not implemented in Module 0');
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

module.exports = {
  AuthError,
  RefreshTokenReuseError,
  UserNotFoundError,
  login,
  refresh,
  revoke,
  requestPasswordReset,
  activateUser,
};
