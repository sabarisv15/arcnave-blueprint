'use strict';

const crypto = require('node:crypto');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const config = require('./config');

// Any invalid/expired/malformed/mis-signed access JWT. Deliberately
// one exception type wrapping jsonwebtoken's whole exception
// hierarchy (JsonWebTokenError, TokenExpiredError, NotBeforeError),
// so callers (AuthMiddleware, tests) don't need to know which
// specific failure mode occurred — an untrustworthy token is an
// untrustworthy token regardless of why. Same reasoning as the
// deleted Python TokenError.
class TokenError extends Error {}

async function hashPassword(password) {
  return argon2.hash(password);
}

async function verifyPassword(password, passwordHash) {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    // argon2.verify rejects on a mismatched password AND on a
    // malformed/corrupt hash alike — unlike Python's argon2-cffi,
    // this package doesn't expose separately-named exceptions to
    // distinguish the two. Both cases mean "this password is not
    // valid for this hash," so treating them the same here isn't a
    // loss of information a caller actually needs.
    return false;
  }
}

// node-argon2 (the `argon2` npm package) does genuinely expose a
// needsRehash(digest, options) helper — verified against the
// package's actual source before relying on it, not assumed from
// Python argon2-cffi's check_needs_rehash() existing. Comparing
// against no explicit options is correct here specifically because
// hashPassword() above also never passes explicit options — both
// calls resolve to the same underlying defaults, so this is really
// comparing a stored hash's embedded parameters against "whatever
// hashPassword would use today."
async function needsRehash(passwordHash) {
  return argon2.needsRehash(passwordHash);
}

function createAccessToken({ userId, collegeId, role }) {
  return jwt.sign(
    { sub: userId, college_id: collegeId, role, type: 'access' },
    config.jwtSecretKey,
    { algorithm: config.jwtAlgorithm, expiresIn: `${config.accessTokenExpireMinutes}m` },
  );
}

function decodeAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecretKey, { algorithms: [config.jwtAlgorithm] });
  } catch (err) {
    throw new TokenError(err.message);
  }
}

function generateRefreshToken() {
  // 32 bytes of server-generated randomness, base64url-encoded (no
  // padding) — same shape as the deleted Python version's
  // secrets.token_urlsafe(32). Not required to be byte-for-byte
  // identical to the old implementation; only its entropy and
  // URL-safety matter, and neither implementation's users survive
  // this rewrite to need continuity (ADR-016 — the volume was reset).
  return crypto.randomBytes(32).toString('base64url');
}

function hashRefreshToken(token) {
  // SHA-256, not argon2, is deliberate here: a refresh token is
  // already ~256 bits of server-generated randomness, not a low-
  // entropy human-chosen secret. Hashing it protects against a DB-read
  // compromise handing out directly-usable tokens; it isn't defending
  // against brute-force guessing the way a password hash has to, so
  // argon2's deliberate slowness buys nothing here and only costs
  // latency on every refresh.
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  TokenError,
  hashPassword,
  verifyPassword,
  needsRehash,
  createAccessToken,
  decodeAccessToken,
  generateRefreshToken,
  hashRefreshToken,
};
