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
//
// Phase 2 (ADR-025 backfill) additions: createPosition/
// createPositionAccount/createPositionOccupant now accept an optional
// migrationBatchId (nullable column, added by
// 1757000000000_migration-state-and-backfill-tagging.js) —
// find/revoke/module/department query shapes are unchanged.
// findActiveOccupancyForUserAtLevel and deleteByMigrationBatch exist
// solely for positionBackfillService's idempotency check and the
// unbackfill script; still query mechanics only, no batching/
// transaction/dry-run decisions made here.

async function createPosition(client, {
  collegeId, level, title, createdBy, migrationBatchId,
}) {
  const result = await client.query(
    `INSERT INTO positions (college_id, level, title, created_by, migration_batch_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [collegeId, level, title, createdBy, migrationBatchId || null],
  );
  return result.rows[0];
}

async function findPositionById(client, id) {
  const result = await client.query('SELECT * FROM positions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function createPositionAccount(client, {
  collegeId, positionId, officialEmail, passwordHash, migrationBatchId,
}) {
  const result = await client.query(
    `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash, migration_batch_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [collegeId, positionId, officialEmail, passwordHash, migrationBatchId || null],
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
  collegeId, positionAccountId, userId, assignedBy, migrationBatchId,
}) {
  const result = await client.query(
    `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by, migration_batch_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [collegeId, positionAccountId, userId, assignedBy, migrationBatchId || null],
  );
  return result.rows[0];
}

// Phase 2 backfill idempotency check (ADR-025's "find-or-create,
// keyed on the legacy source row"): is this person already the active
// occupant of a position at this level for this college? Used before
// creating a Level 1/Level 3 position so re-running the backfill (or
// running it again after a partial manual intervention) never creates
// a second position for the same legacy Principal/HOD — it just finds
// the one already there and moves on.
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

// Unbackfill (ADR-025): delete only rows tagged with this exact batch
// id, in FK-safe order (occupants -> accounts -> positions). Never a
// blind delete by college_id — a batch id is the only thing that can
// distinguish backfill-created rows from anything created afterward
// (e.g. Phase 4's Create/Edit College UI) for the same college.
async function deleteByMigrationBatch(client, migrationBatchId) {
  const occupants = await client.query(
    'DELETE FROM position_occupants WHERE migration_batch_id = $1 RETURNING college_id',
    [migrationBatchId],
  );
  const accounts = await client.query(
    'DELETE FROM position_accounts WHERE migration_batch_id = $1 RETURNING college_id',
    [migrationBatchId],
  );
  const positions = await client.query(
    'DELETE FROM positions WHERE migration_batch_id = $1 RETURNING college_id',
    [migrationBatchId],
  );
  const collegeIds = new Set([
    ...occupants.rows.map((r) => r.college_id),
    ...accounts.rows.map((r) => r.college_id),
    ...positions.rows.map((r) => r.college_id),
  ]);
  return {
    occupantsDeleted: occupants.rowCount,
    accountsDeleted: accounts.rowCount,
    positionsDeleted: positions.rowCount,
    collegeIds: [...collegeIds],
  };
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

// All distinct colleges that have at least one row tagged with this
// batch id, across all three taggable tables — used by the unbackfill
// script to know which colleges' migration_state to check/revert
// before it deletes anything.
async function findCollegeIdsForMigrationBatch(client, migrationBatchId) {
  const result = await client.query(
    `SELECT college_id FROM positions WHERE migration_batch_id = $1
     UNION
     SELECT college_id FROM position_accounts WHERE migration_batch_id = $1
     UNION
     SELECT college_id FROM position_occupants WHERE migration_batch_id = $1`,
    [migrationBatchId],
  );
  return result.rows.map((r) => r.college_id);
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
  findActiveOccupancyForUserAtLevel,
  deleteByMigrationBatch,
  findCollegeIdsForMigrationBatch,
};
