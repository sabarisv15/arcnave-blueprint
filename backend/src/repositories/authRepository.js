'use strict';

// Query mechanics for `users` and `refresh_tokens` only — no business
// logic (see services/authService.js for that). Both are RLS-scoped
// tenant tables; every query here runs through req.dbClient, the same
// tenant-scoped transaction TenantMiddleware opened for this request,
// so results are implicitly filtered to whatever tenant it resolved
// — same as tenant.js's own colleges lookups, just against different
// tables.
//
// No createUser here — this pass only ports login/refresh/logout
// (auth_service.py's original scope). Creating a user is principal
// invitation's concern, a separate later slice, not needed by
// anything built this pass.

async function getUserByUsername(client, collegeId, username) {
  const result = await client.query(
    `SELECT id, college_id, username, password_hash, role, is_active
     FROM users WHERE college_id = $1 AND username = $2`,
    [collegeId, username],
  );
  return result.rows[0] || null;
}

async function getUserById(client, userId) {
  const result = await client.query(
    `SELECT id, college_id, username, password_hash, role, is_active
     FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function updatePasswordHash(client, userId, passwordHash) {
  await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

async function createRefreshToken(client, { collegeId, userId, tokenHash, expiresAt }) {
  await client.query(
    `INSERT INTO refresh_tokens (college_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [collegeId, userId, tokenHash, expiresAt],
  );
}

async function getRefreshTokenByHash(client, tokenHash) {
  const result = await client.query(
    `SELECT id, college_id, user_id, token_hash, issued_at, expires_at, revoked_at
     FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

async function revokeRefreshToken(client, tokenId) {
  await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [tokenId]);
}

module.exports = {
  getUserByUsername,
  getUserById,
  updatePasswordHash,
  createRefreshToken,
  getRefreshTokenByHash,
  revokeRefreshToken,
};
