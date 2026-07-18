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
    `SELECT id, college_id, username, email, password_hash, role, is_active, mfa_enabled
     FROM users WHERE college_id = $1 AND username = $2`,
    [collegeId, username],
  );
  return result.rows[0] || null;
}

async function getUserById(client, userId) {
  const result = await client.query(
    `SELECT id, college_id, username, email, password_hash, role, is_active, mfa_enabled
     FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

// requestPasswordReset's own lookup: a user identifies themselves by
// email, not username (there is no login-time equivalent — login
// always takes a username). email has no UNIQUE constraint on this
// table, unlike (college_id, username), so this can in principle match
// more than one row; ORDER BY id keeps the result deterministic rather
// than whatever order Postgres happens to return, same defensive
// instinct as staffRepository's own tie-break comment.
async function getUserByEmail(client, collegeId, email) {
  const result = await client.query(
    `SELECT id, college_id, username, email, role, is_active
     FROM users WHERE college_id = $1 AND email = $2
     ORDER BY id LIMIT 1`,
    [collegeId, email],
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

// BusinessRules.md Staff lifecycle: "staff accounts are deactivated,
// never deleted." The `is_active` flip alone — no password_hash
// change, unlike activateUser: a deactivated account has no business
// reason to also invalidate whatever credentials it had, since it
// can't log in regardless while is_active is false. Flipping
// is_active also fires this table's own users_sync_active_hod_department
// trigger (1753800000000), automatically clearing
// active_hod_department_id if this user was the department's active
// HOD — no separate step needed here for that.
async function deactivateUser(client, userId) {
  const result = await client.query(
    `UPDATE users SET is_active = false
     WHERE id = $1
     RETURNING id, college_id, username, email, role, is_active, activated_by`,
    [userId],
  );
  return result.rows[0] || null;
}

// authService.enableMfa/disableMfa — the user's own self-opt-in flag
// (meaningful only under institution mode 'optional'; see the
// 1756100000000 migration's own file-level comment for why this is a
// plain column here rather than a 'auth' configurations-category
// field: per-user state, not per-tenant policy).
async function setMfaEnabled(client, userId, enabled) {
  const result = await client.query(
    `UPDATE users SET mfa_enabled = $1
     WHERE id = $2
     RETURNING id, college_id, username, email, role, is_active, mfa_enabled`,
    [enabled, userId],
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

// password_reset_tokens — same shape/reasoning as refresh_tokens
// above, just for the reset flow (see authService.requestPasswordReset/
// resetPassword).
async function createPasswordResetToken(client, { collegeId, userId, tokenHash, expiresAt }) {
  await client.query(
    `INSERT INTO password_reset_tokens (college_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [collegeId, userId, tokenHash, expiresAt],
  );
}

async function getPasswordResetTokenByHash(client, tokenHash) {
  const result = await client.query(
    `SELECT id, college_id, user_id, token_hash, issued_at, expires_at, used_at
     FROM password_reset_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

async function markPasswordResetTokenUsed(client, tokenId) {
  await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [tokenId]);
}

module.exports = {
  createUser,
  getUserByUsername,
  getUserById,
  getUserByEmail,
  updatePasswordHash,
  activateUser,
  deactivateUser,
  setMfaEnabled,
  createRefreshToken,
  getRefreshTokenByHash,
  revokeRefreshToken,
  createPasswordResetToken,
  getPasswordResetTokenByHash,
  markPasswordResetTokenUsed,
};
