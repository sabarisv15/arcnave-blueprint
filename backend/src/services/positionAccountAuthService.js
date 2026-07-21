'use strict';

// Phase 2 (Position Account Auth) step 3: login/refresh/revoke for the
// Institutional Identity Context — one generic service covering every
// level Position Account login applies to (L1/L2/L3 today; the Class
// Tutor assignment, Level 4 + position_type='class_tutor', joins once
// group (b)/(c) of the plan lands its schema and resolvers). Mirrors
// authService.js's login/refresh/revoke shape deliberately, but is a
// SEPARATE service, not a branch inside it: a Position Account has no
// `users` row, no `role` claim, and its own token_version/refresh-token
// tables — trying to share authService's functions would mean
// threading a users-vs-position_accounts fork through every one of
// them for no real reuse.
//
// Not wired to any route or middleware yet — that's step 5/7. This
// step only proves login/refresh/revoke work end-to-end against the
// position_accounts/position_account_refresh_tokens tables.

const config = require('../config');
const security = require('../security');
const positionRepository = require('../repositories/positionRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const { logWarn } = require('../logging/logger');

// Generic authentication failure — same "one message for every failure
// mode" reasoning as authService.AuthError: unknown email, wrong
// password, and (once assertLevelAllowsPositionLogin can actually
// fail in practice) a disallowed position all raise this, so no
// response can reveal which happened.
class PositionAuthError extends Error {}

// Mirrors authService.RefreshTokenReuseError — a possible-theft signal
// (an already-revoked position_account_refresh_tokens row presented
// again), not a routine rejection.
class PositionRefreshTokenReuseError extends Error {}

// Decision 1 of the Phase 2 plan: only Level 1/2/3 positions, and a
// Level 4 position carrying position_type='class_tutor', are ever
// eligible for Position Account login. Plain Level 4 staff (no
// Position row at all) never reach this — there's no position_accounts
// row to look up an email against — but this guard exists so a future,
// not-yet-invented position_type can't accidentally gain login just by
// having a position_accounts row created for it.
function assertLevelAllowsPositionLogin(position) {
  const isStructuralLevel = position.level >= 1 && position.level <= 3;
  const isClassTutor = position.level === 4 && position.position_type === 'class_tutor';
  if (!isStructuralLevel && !isClassTutor) {
    throw new PositionAuthError(`position ${JSON.stringify(position.id)} is not eligible for Position Account login`);
  }
}

async function issuePositionTokenPair(client, { collegeId, positionAccountId, tokenVersion }) {
  const accessToken = security.createPositionAccessToken({
    positionAccountId, collegeId, tokenVersion,
  });
  const refreshToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenExpireDays * 24 * 60 * 60 * 1000);
  await positionRepository.createPositionAccountRefreshToken(client, {
    collegeId,
    positionAccountId,
    tokenHash: security.hashRefreshToken(refreshToken),
    expiresAt,
  });
  return { accessToken, refreshToken, tokenType: 'bearer' };
}

// Enumeration-safe like authService.login: an unknown official_email,
// a wrong password, and a login attempt against a not-yet-eligible
// position all fail identically. Audited both ways (BusinessRules.md
// Central audit log names login/logout explicitly) — userId is always
// null here (no `users` row is the actor; the Position Account itself
// is), positionAccountId/positionId passed explicitly so this doesn't
// fall back to whatever ambient position context (if any) the calling
// request happens to carry.
async function login(client, { collegeId, officialEmail, password }) {
  const account = await positionRepository.findPositionAccountByOfficialEmail(client, collegeId, officialEmail);

  let failureReason = null;
  let position = null;
  if (!account) {
    failureReason = 'unknown_official_email';
  } else if (!(await security.verifyPassword(password, account.password_hash))) {
    failureReason = 'bad_password';
  } else {
    position = await positionRepository.findPositionById(client, account.position_id);
    try {
      assertLevelAllowsPositionLogin(position);
    } catch (err) {
      failureReason = 'position_not_login_eligible';
    }
  }

  if (failureReason !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId,
      userId: null,
      action: 'position_account_login',
      entity: 'position_accounts',
      entityId: account ? account.id : null,
      metadata: { result: 'failure', reason: failureReason, officialEmail },
      positionAccountId: account ? account.id : null,
      positionId: account ? account.position_id : null,
    });
    throw new PositionAuthError('Invalid official email or password');
  }

  if (await security.needsRehash(account.password_hash)) {
    await positionRepository.updatePositionAccountCredentials(client, account.id, await security.hashPassword(password));
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: null,
    action: 'position_account_login',
    entity: 'position_accounts',
    entityId: account.id,
    metadata: { result: 'success' },
    positionAccountId: account.id,
    positionId: position.id,
  });

  return issuePositionTokenPair(client, {
    collegeId, positionAccountId: account.id, tokenVersion: account.token_version,
  });
}

async function refresh(client, rawRefreshToken) {
  const tokenHash = security.hashRefreshToken(rawRefreshToken || '');
  const stored = await positionRepository.getPositionAccountRefreshTokenByHash(client, tokenHash);

  if (!stored) {
    throw new PositionAuthError('Invalid refresh token');
  }

  if (stored.revoked_at !== null) {
    logWarn('position_account_refresh_token_reuse_detected', {
      collegeId: stored.college_id,
      positionAccountId: stored.position_account_id,
      refreshTokenId: stored.id,
      originallyRevokedAt: stored.revoked_at,
    });
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: stored.college_id,
      userId: null,
      action: 'position_account_refresh_token_reuse_detected',
      entity: 'position_account_refresh_tokens',
      entityId: stored.id,
      metadata: { originallyRevokedAt: stored.revoked_at },
      positionAccountId: stored.position_account_id,
      positionId: null,
    });
    throw new PositionRefreshTokenReuseError('Refresh token was already revoked');
  }

  if (stored.expires_at.getTime() <= Date.now()) {
    throw new PositionAuthError('Refresh token has expired');
  }

  const account = await positionRepository.findPositionAccountById(client, stored.position_account_id);
  if (!account) {
    throw new PositionAuthError('Position Account no longer exists');
  }

  await positionRepository.revokePositionAccountRefreshToken(client, stored.id);
  return issuePositionTokenPair(client, {
    collegeId: account.college_id, positionAccountId: account.id, tokenVersion: account.token_version,
  });
}

// Logout — idempotent and silent for an unknown/already-revoked token,
// same reasoning as authService.revoke: the client's intent is already
// satisfied either way.
async function revoke(client, rawRefreshToken) {
  const tokenHash = security.hashRefreshToken(rawRefreshToken || '');
  const stored = await positionRepository.getPositionAccountRefreshTokenByHash(client, tokenHash);
  if (stored && stored.revoked_at === null) {
    await positionRepository.revokePositionAccountRefreshToken(client, stored.id);
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: stored.college_id,
      userId: null,
      action: 'position_account_logout',
      entity: 'position_account_refresh_tokens',
      entityId: stored.id,
      metadata: null,
      positionAccountId: stored.position_account_id,
      positionId: null,
    });
  }
}

module.exports = {
  PositionAuthError,
  PositionRefreshTokenReuseError,
  assertLevelAllowsPositionLogin,
  login,
  refresh,
  revoke,
};
