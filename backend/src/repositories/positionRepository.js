'use strict';

// Query mechanics ONLY for the ADR-021 tables: positions,
// position_accounts, position_occupants, position_module_assignments,
// position_department_assignments. Deliberately minimal — no business
// logic, no resolver, no identityService (that's identityService.js's
// job, not this repository's). This exists solely so this schema's
// own constraint invariants (one position_accounts row per position,
// one active occupant per account, one active module/department
// assignment) can be exercised by a real test, same reasoning every
// other *Repository.js in this codebase keeps query mechanics
// separate from the service that would eventually own them. No table
// here calls into another table's own repository (none exists yet) —
// kept as one file across five tables only because nothing outside
// constraint tests consumes any of this yet.
async function createPosition(client, {
  collegeId, level, title, createdBy,
}) {
  const result = await client.query(
    `INSERT INTO positions (college_id, level, title, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, level, title, createdBy],
  );
  return result.rows[0];
}

async function findPositionById(client, id) {
  const result = await client.query('SELECT * FROM positions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// authService.acceptInvitation's idempotency guard: is there already a
// position at this level for this college (e.g. a principal was
// already re-invited/accepted once through this same path)? Positions
// has no unique constraint on (college_id, level) — provisioning
// checks before inserting instead, same "let the caller decide, the
// schema doesn't enforce this for you" reasoning
// findActiveOccupancyForUserAtLevel below already applies. Oldest
// first (there should only ever be one) so a bug that somehow created
// two resolves deterministically to the first-created one.
async function findActivePositionByCollegeAndLevel(client, collegeId, level) {
  const result = await client.query(
    'SELECT * FROM positions WHERE college_id = $1 AND level = $2 ORDER BY created_at ASC LIMIT 1',
    [collegeId, level],
  );
  return result.rows[0] || null;
}

async function createPositionAccount(client, {
  collegeId, positionId, officialEmail, passwordHash,
}) {
  const result = await client.query(
    `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, positionId, officialEmail, passwordHash],
  );
  return result.rows[0];
}

async function findPositionAccountByPositionId(client, positionId) {
  const result = await client.query(
    'SELECT * FROM position_accounts WHERE position_id = $1',
    [positionId],
  );
  return result.rows[0] || null;
}

async function createPositionOccupant(client, {
  collegeId, positionAccountId, userId, assignedBy,
}) {
  const result = await client.query(
    `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, positionAccountId, userId, assignedBy],
  );
  return result.rows[0];
}

// Idempotency check: is this person already the active occupant of a
// position at this level for this college? Used before creating a
// Level 1/Level 3 position so re-provisioning never creates a second
// position for the same person — it just finds the one already there
// and moves on.
async function findActiveOccupancyForUserAtLevel(client, { collegeId, level, userId }) {
  const result = await client.query(
    `SELECT po.* FROM position_occupants po
     JOIN positions p ON p.id = (
       SELECT position_id FROM position_accounts WHERE id = po.position_account_id
     )
     WHERE p.college_id = $1 AND p.level = $2 AND po.user_id = $3 AND po.revoked_at IS NULL`,
    [collegeId, level, userId],
  );
  return result.rows[0] || null;
}

async function findActiveOccupant(client, positionAccountId) {
  const result = await client.query(
    `SELECT * FROM position_occupants
     WHERE position_account_id = $1 AND revoked_at IS NULL`,
    [positionAccountId],
  );
  return result.rows[0] || null;
}

// identityService.js's resolvers — query mechanics for the five
// internal lookups. Still pure query mechanics only, no resolution/
// comparison logic (that lives in services/identity/*Resolver.js and
// identityService.js) — same split this file already keeps above.
//
// positionResolver's core lookup: every position this user actively
// occupies, in this college, right now — joins occupant -> account ->
// position, filtered on revoked_at IS NULL. A user can (in principle)
// occupy more than one active position; the resolver, not this query,
// decides how to combine multiple results (e.g. "highest level wins").
async function findActivePositionsForUser(client, { collegeId, userId }) {
  const result = await client.query(
    `SELECT p.id AS position_id, p.level, p.title, pa.id AS position_account_id
     FROM position_occupants po
     JOIN position_accounts pa ON pa.id = po.position_account_id
     JOIN positions p ON p.id = pa.position_id
     WHERE p.college_id = $1 AND po.user_id = $2 AND po.revoked_at IS NULL
     ORDER BY p.level ASC`,
    [collegeId, userId],
  );
  return result.rows;
}

// moduleResolver's core lookup: every module a position currently owns
// (active assignments only) — position_module_assignments already
// enforces "one active assignment per college+module" at the DB level
// (an exclusive lock), so a position can own zero or more distinct
// modules, but no two positions can share one at the same time.
async function findActiveModuleAssignmentsForPosition(client, positionId) {
  const result = await client.query(
    `SELECT * FROM position_module_assignments
     WHERE position_id = $1 AND revoked_at IS NULL
     ORDER BY module_key`,
    [positionId],
  );
  return result.rows;
}

// departmentResolver's core lookup: every department currently mapped
// to a position (active assignments only) — mirrors
// findActiveModuleAssignmentsForPosition above, same shape, different
// table.
async function findActiveDepartmentAssignmentsForPosition(client, positionId) {
  const result = await client.query(
    `SELECT * FROM position_department_assignments
     WHERE position_id = $1 AND revoked_at IS NULL
     ORDER BY department_id`,
    [positionId],
  );
  return result.rows;
}

async function revokePositionOccupant(client, id, { revokedBy }) {
  const result = await client.query(
    `UPDATE position_occupants SET revoked_at = now(), revoked_by = $2
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [id, revokedBy],
  );
  return result.rows[0] || null;
}

async function createPositionModuleAssignment(client, {
  collegeId, positionId, moduleKey, assignedBy,
}) {
  const result = await client.query(
    `INSERT INTO position_module_assignments (college_id, position_id, module_key, assigned_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, positionId, moduleKey, assignedBy],
  );
  return result.rows[0];
}

async function findActiveModuleAssignment(client, collegeId, moduleKey) {
  const result = await client.query(
    `SELECT * FROM position_module_assignments
     WHERE college_id = $1 AND module_key = $2 AND revoked_at IS NULL`,
    [collegeId, moduleKey],
  );
  return result.rows[0] || null;
}

async function revokePositionModuleAssignment(client, id, { revokedBy }) {
  const result = await client.query(
    `UPDATE position_module_assignments SET revoked_at = now(), revoked_by = $2
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [id, revokedBy],
  );
  return result.rows[0] || null;
}

async function createPositionDepartmentAssignment(client, {
  collegeId, positionId, departmentId, assignedBy,
}) {
  const result = await client.query(
    `INSERT INTO position_department_assignments (college_id, position_id, department_id, assigned_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [collegeId, positionId, departmentId, assignedBy],
  );
  return result.rows[0];
}

async function findActiveDepartmentAssignment(client, departmentId) {
  const result = await client.query(
    `SELECT * FROM position_department_assignments
     WHERE department_id = $1 AND revoked_at IS NULL`,
    [departmentId],
  );
  return result.rows[0] || null;
}

async function revokePositionDepartmentAssignment(client, id, { revokedBy }) {
  const result = await client.query(
    `UPDATE position_department_assignments SET revoked_at = now(), revoked_by = $2
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [id, revokedBy],
  );
  return result.rows[0] || null;
}

// Phase 2 (Position Account Auth) additions below — query mechanics
// for position_accounts login/credential/session-revocation state and
// position_account_refresh_tokens, mirroring authRepository.js's
// users/refresh_tokens functions exactly, table-for-table.

async function findPositionAccountByOfficialEmail(client, collegeId, officialEmail) {
  const result = await client.query(
    `SELECT * FROM position_accounts WHERE college_id = $1 AND official_email = $2`,
    [collegeId, officialEmail],
  );
  return result.rows[0] || null;
}

async function findPositionAccountById(client, id) {
  const result = await client.query('SELECT * FROM position_accounts WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function updatePositionAccountCredentials(client, id, passwordHash) {
  await client.query('UPDATE position_accounts SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
}

// Same "bump by exactly one, never a blind SET" reasoning as
// authRepository.incrementTokenVersion — this is what revokes every
// access token already issued for this Position Account.
async function incrementPositionAccountTokenVersion(client, id) {
  const result = await client.query(
    'UPDATE position_accounts SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
    [id],
  );
  return result.rows[0] ? result.rows[0].token_version : null;
}

// middleware/sessionRevocation.js's Position Account counterpart to
// authRepository.getTokenVersion — returns null for an unknown id so
// the middleware's comparison fails closed rather than throwing.
async function getPositionAccountTokenVersion(client, id) {
  const result = await client.query('SELECT token_version FROM position_accounts WHERE id = $1', [id]);
  return result.rows[0] ? result.rows[0].token_version : null;
}

// Reassignment lifecycle (ADR-021 §10): clears MFA/recovery state on
// the outgoing occupant's way out, same moment token_version is bumped.
async function clearPositionAccountMfaAndRecovery(client, id) {
  await client.query(
    `UPDATE position_accounts
     SET mfa_enabled = false, mfa_secret = NULL, recovery_email = NULL, recovery_phone = NULL
     WHERE id = $1`,
    [id],
  );
}

async function createPositionAccountRefreshToken(client, {
  collegeId, positionAccountId, tokenHash, expiresAt,
}) {
  await client.query(
    `INSERT INTO position_account_refresh_tokens (college_id, position_account_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [collegeId, positionAccountId, tokenHash, expiresAt],
  );
}

async function getPositionAccountRefreshTokenByHash(client, tokenHash) {
  const result = await client.query(
    `SELECT id, college_id, position_account_id, token_hash, issued_at, expires_at, revoked_at
     FROM position_account_refresh_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

async function revokePositionAccountRefreshToken(client, tokenId) {
  await client.query('UPDATE position_account_refresh_tokens SET revoked_at = now() WHERE id = $1', [tokenId]);
}

module.exports = {
  createPosition,
  findPositionById,
  findActivePositionByCollegeAndLevel,
  createPositionAccount,
  findPositionAccountByPositionId,
  createPositionOccupant,
  findActiveOccupant,
  revokePositionOccupant,
  createPositionModuleAssignment,
  findActiveModuleAssignment,
  revokePositionModuleAssignment,
  createPositionDepartmentAssignment,
  findActiveDepartmentAssignment,
  revokePositionDepartmentAssignment,
  findActiveOccupancyForUserAtLevel,
  findActivePositionsForUser,
  findActiveModuleAssignmentsForPosition,
  findActiveDepartmentAssignmentsForPosition,
  findPositionAccountByOfficialEmail,
  findPositionAccountById,
  updatePositionAccountCredentials,
  incrementPositionAccountTokenVersion,
  getPositionAccountTokenVersion,
  clearPositionAccountMfaAndRecovery,
  createPositionAccountRefreshToken,
  getPositionAccountRefreshTokenByHash,
  revokePositionAccountRefreshToken,
};
