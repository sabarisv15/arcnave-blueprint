'use strict';

// Query mechanics for `users` and `refresh_tokens` only — no business
// logic (see services/authService.js for that). Both are RLS-scoped
// tenant tables; every query here runs through req.dbClient, the same
// tenant-scoped transaction TenantMiddleware opened for this request,
// so results are implicitly filtered to whatever tenant it resolved
// — same as tenant.js's own colleges lookups, just against different
// tables.
//
// createUser is a plain, generic INSERT — not principal-invitation-
// specific, even though that's the first caller. Reusable by any
// future flow that needs to create a tenant user.

async function createUser(client, { collegeId, username, email, passwordHash, role, isActive }) {
  const result = await client.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, college_id, username, email, role, is_active`,
    [collegeId, username, email, passwordHash, role, isActive],
  );
  return result.rows[0];
}

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

// Module 8: sets a fresh password_hash and flips is_active/activated_by
// in one statement — the "activation" moment BusinessRules.md's Staff
// registration chain describes ("login is enabled only once
// credentials exist"). Returns null if userId doesn't exist (shouldn't
// happen given staff.user_id's own FK, but this repository makes no
// assumption about who's calling it).
async function activateUser(client, userId, { passwordHash, activatedBy }) {
  const result = await client.query(
    `UPDATE users SET password_hash = $1, is_active = true, activated_by = $2
     WHERE id = $3
     RETURNING id, college_id, username, email, role, is_active, activated_by`,
    [passwordHash, activatedBy, userId],
  );
  return result.rows[0] || null;
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
  createUser,
  getUserByUsername,
  getUserById,
  updatePasswordHash,
  activateUser,
  createRefreshToken,
  getRefreshTokenByHash,
  revokeRefreshToken,
};
