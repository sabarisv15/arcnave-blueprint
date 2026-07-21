'use strict';

// Query mechanics ONLY for Identity-Migration-Plan.md Phase 2 (ADR-025
// backfill) / the plan's "College Migration State" mechanism — the
// `colleges.migration_state` column and the legacy-source reads the
// backfill needs (active Principal, departments, active HOD). No
// business logic (idempotency decisions, transaction boundaries,
// dry-run reporting) lives here — that's positionBackfillService.js's
// job, same separation positionRepository.js already keeps.
//
// Deliberately does not call hodInChargeRepository or any other
// repository (CLAUDE.md: "Repositories never call other
// repositories") — positionBackfillService composes this repository
// with hodInChargeRepository itself.
//
// Every function here is expected to run against MIGRATION_DATABASE_URL
// (arcnave_admin) — the backfill is inherently cross-tenant (it reads
// and writes across every college in one job run), which is exactly
// the kind of access RLS-scoped arcnave_app was never meant to have.
// This mirrors position-schema.test.js's own fixture-seeding
// connection, not a new pattern.

async function findCollegesByMigrationState(client, migrationState) {
  const result = await client.query(
    'SELECT college_id FROM colleges WHERE migration_state = $1 ORDER BY college_id',
    [migrationState],
  );
  return result.rows.map((r) => r.college_id);
}

// Locks the college row for the duration of the surrounding
// transaction and returns its current migration_state — used at the
// top of each per-college transaction so two concurrent backfill runs
// can never both decide the same college is still LEGACY and race to
// backfill it twice.
async function lockCollege(client, collegeId) {
  const result = await client.query(
    'SELECT college_id, migration_state FROM colleges WHERE college_id = $1 FOR UPDATE',
    [collegeId],
  );
  return result.rows[0] || null;
}

// Compare-and-swap: only moves the state if it still matches `from`.
// Returns null (not an error) if another process already moved it —
// the caller treats that as "nothing to do," not a failure.
async function setMigrationState(client, collegeId, { from, to }) {
  const result = await client.query(
    `UPDATE colleges SET migration_state = $3
     WHERE college_id = $1 AND migration_state = $2
     RETURNING college_id, migration_state`,
    [collegeId, from, to],
  );
  return result.rows[0] || null;
}

// Identity-Migration-Plan.md Phase 3 (identityService, shadow mode):
// a plain, no-lock read of one college's current migration_state —
// unlike lockCollege above (which is Phase 2's backfill-only,
// SELECT ... FOR UPDATE gate meant to run inside a write transaction
// against MIGRATION_DATABASE_URL), this is a read-only lookup the
// runtime request path calls on every request through the ordinary
// tenant-scoped req.dbClient connection, to decide whether the
// requesting user's college is eligible for shadow-mode enrollment
// (BACKFILLED or later — never LEGACY, per the plan's explicit
// sequencing fix). arcnave_app already holds a table-level SELECT
// grant on `colleges` (1751500000000's own GRANT), colleges carries no
// RLS policy of its own (it IS the tenant registry, not tenant data),
// so this is safe to call from either connection role.
async function getMigrationState(client, collegeId) {
  const result = await client.query(
    'SELECT migration_state FROM colleges WHERE college_id = $1',
    [collegeId],
  );
  return result.rows[0] ? result.rows[0].migration_state : null;
}

async function findActivePrincipal(client, collegeId) {
  const result = await client.query(
    `SELECT * FROM users
     WHERE college_id = $1 AND role = 'principal' AND is_active = true`,
    [collegeId],
  );
  return result.rows[0] || null;
}

async function findDepartments(client, collegeId) {
  const result = await client.query(
    'SELECT * FROM departments WHERE college_id = $1 ORDER BY name',
    [collegeId],
  );
  return result.rows;
}

// The primary source for a department's active HOD — the mirrored
// active_hod_department_id column 1753800000000_single-active-hod.js
// maintains, same column users_one_active_hod_per_department is built
// on. hod_in_charge_appointments (the fallback, queried separately by
// positionBackfillService via hodInChargeRepository) is only consulted
// when this returns null.
async function findActiveHodUser(client, collegeId, departmentId) {
  const result = await client.query(
    `SELECT * FROM users
     WHERE college_id = $1 AND role = 'hod' AND is_active = true
       AND active_hod_department_id = $2`,
    [collegeId, departmentId],
  );
  return result.rows[0] || null;
}

async function findUserById(client, userId) {
  const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] || null;
}

module.exports = {
  findCollegesByMigrationState,
  lockCollege,
  setMigrationState,
  getMigrationState,
  findActivePrincipal,
  findDepartments,
  findActiveHodUser,
  findUserById,
};
