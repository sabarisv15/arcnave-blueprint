'use strict';

// Query mechanics ONLY for the Phase 1 (Identity-Migration-Plan.md /
// ADR-021) tables: positions, position_accounts, position_occupants,
// position_module_assignments, position_department_assignments.
// Deliberately minimal — no business logic, no resolver, no
// identityService (that's Phase 3+, out of scope for this slice).
// This exists solely so this migration's own constraint invariants
// (one position_accounts row per position, one active occupant per
// account, one active module/department assignment) can be exercised
// by a real test, same reasoning every other *Repository.js in this
// codebase keeps query mechanics separate from the service that would
// eventually own them. No table here calls into another table's own
// repository (none exists yet) — kept as one file across five tables
// only because nothing outside constraint tests consumes any of this
// yet; a real per-table split can happen once Phase 3's identityService
// actually needs one.

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

async function findActiveOccupant(client, positionAccountId) {
  const result = await client.query(
    `SELECT * FROM position_occupants
     WHERE position_account_id = $1 AND revoked_at IS NULL`,
    [positionAccountId],
  );
  return result.rows[0] || null;
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

module.exports = {
  createPosition,
  findPositionById,
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
};
