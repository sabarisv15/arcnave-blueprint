'use strict';

// Coverage for Identity-Migration-Plan.md Phase 2 / ADR-025's backfill
// mechanism — services/positionBackfillService.js, on top of
// repositories/collegeMigrationRepository.js and positionRepository.js's
// Phase 2 additions. Runs against a real Postgres via
// MIGRATION_DATABASE_URL (arcnave_admin, bypasses RLS — same fixture-
// seeding role position-schema.test.js already uses for this exact
// reason: the backfill itself is inherently cross-tenant).
//
// Covers, per the task's own exit list: idempotency (re-running a
// backfilled college is a no-op), tagging (every created row carries
// the run's migration_batch_id), per-college transaction isolation (one
// college's failure never touches another college's data or state),
// the HOD-in-Charge fallback path, and unbackfill's selective,
// batch-scoped delete (never a blind delete by college_id).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const positionBackfillService = require('../src/services/positionBackfillService');
const hodInChargeRepository = require('../src/repositories/hodInChargeRepository');
const positionRepository = require('../src/repositories/positionRepository');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD_HASH = 'x';

async function insertCollege(pool, collegeId) {
  await pool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)',
    [collegeId],
  );
}

async function insertUser(pool, {
  collegeId, username, role, isActive = true, passwordHash = PASSWORD_HASH,
}) {
  const result = await pool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, $2, $2 || '@example.test', $3, $4, $5)
     RETURNING *`,
    [collegeId, username, passwordHash, role, isActive],
  );
  return result.rows[0];
}

async function insertDepartment(pool, collegeId, name) {
  const result = await pool.query(
    'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING *',
    [collegeId, name],
  );
  return result.rows[0];
}

async function insertStaffLinkedToDepartment(pool, { collegeId, userId, fullName, departmentId }) {
  await pool.query(
    `INSERT INTO staff (college_id, user_id, full_name, department, department_id)
     VALUES ($1, $2, $3, 'ignored', $4)`,
    [collegeId, userId, fullName, departmentId],
  );
}

async function cleanupCollege(pool, collegeId) {
  await pool.query('DELETE FROM position_occupants WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_accounts WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM positions WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM hod_in_charge_appointments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM staff WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM departments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

test('positionBackfillService (Phase 2 / ADR-025)', async (t) => {
  const pool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeIds = [];

  t.after(async () => {
    for (const collegeId of collegeIds) {
      // eslint-disable-next-line no-await-in-loop -- test teardown, small fixed set
      await cleanupCollege(pool, collegeId);
    }
    await pool.end();
  });

  await t.test('backfills principal + HOD (role path), tags rows, moves state, and is idempotent on rerun', async () => {
    const collegeId = `bf${suffix}a`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const principal = await insertUser(pool, { collegeId, username: 'principal', role: 'principal' });
    const hod = await insertUser(pool, { collegeId, username: 'hod', role: 'hod' });
    const dept = await insertDepartment(pool, collegeId, 'CSE');
    await insertStaffLinkedToDepartment(pool, {
      collegeId, userId: hod.id, fullName: 'HOD Person', departmentId: dept.id,
    });

    const dryRun = await positionBackfillService.runBackfill(pool, { dryRun: true, collegeIds: [collegeId] });
    const dryRunEntry = dryRun.results.find((r) => r.collegeId === collegeId);
    assert.equal(dryRunEntry.principal.status, 'would-create');
    assert.equal(dryRunEntry.principal.userId, principal.id);
    assert.equal(dryRunEntry.departments[0].status, 'would-create');
    assert.equal(dryRunEntry.departments[0].source, 'hod-role');
    assert.equal(dryRunEntry.departments[0].userId, hod.id);

    // Dry run must never write.
    const afterDryRun = await pool.query('SELECT * FROM positions WHERE college_id = $1', [collegeId]);
    assert.equal(afterDryRun.rows.length, 0);

    const realRun = await positionBackfillService.runBackfill(pool, { collegeIds: [collegeId] });
    const realEntry = realRun.results.find((r) => r.collegeId === collegeId);
    assert.equal(realEntry.principal.status, 'created');
    assert.equal(realEntry.departments[0].status, 'created');
    assert.equal(realEntry.migrationState, 'BACKFILLED');

    const positions = await pool.query('SELECT * FROM positions WHERE college_id = $1 ORDER BY level', [collegeId]);
    assert.equal(positions.rows.length, 2);
    assert.equal(positions.rows[0].level, 1);
    assert.equal(positions.rows[1].level, 3);
    // Tagging: every row created carries this run's migration_batch_id.
    for (const row of positions.rows) {
      assert.equal(row.migration_batch_id, realRun.batchId);
    }

    const accounts = await pool.query('SELECT * FROM position_accounts WHERE college_id = $1', [collegeId]);
    assert.equal(accounts.rows.length, 2);
    for (const row of accounts.rows) {
      assert.equal(row.migration_batch_id, realRun.batchId);
    }

    const occupants = await pool.query('SELECT * FROM position_occupants WHERE college_id = $1', [collegeId]);
    assert.equal(occupants.rows.length, 2);
    for (const row of occupants.rows) {
      assert.equal(row.migration_batch_id, realRun.batchId);
    }

    const collegeRow = await pool.query('SELECT migration_state FROM colleges WHERE college_id = $1', [collegeId]);
    assert.equal(collegeRow.rows[0].migration_state, 'BACKFILLED');

    // Idempotency: college is no longer LEGACY, so re-processing it is
    // a clean no-op skip — no duplicate rows, no error.
    const secondRun = await positionBackfillService.runBackfill(pool, { collegeIds: [collegeId] });
    const secondRunEntry = secondRun.results.find((r) => r.collegeId === collegeId);
    assert.equal(secondRunEntry.skipped, true);

    const positionsAfterRerun = await pool.query('SELECT * FROM positions WHERE college_id = $1', [collegeId]);
    assert.equal(positionsAfterRerun.rows.length, 2, 'rerun must not create duplicate rows');
  });

  await t.test('falls back to hod_in_charge_appointments when no active role=hod user exists for the department', async () => {
    const collegeId = `bf${suffix}b`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    await insertUser(pool, { collegeId, username: 'principal', role: 'principal' });
    const dept = await insertDepartment(pool, collegeId, 'ECE');
    const facultyActingAsHod = await insertUser(pool, { collegeId, username: 'faculty1', role: 'staff' });
    const appointer = await insertUser(pool, { collegeId, username: 'appointer', role: 'principal', isActive: false });
    await hodInChargeRepository.create(pool, {
      collegeId,
      departmentId: dept.id,
      facultyUserId: facultyActingAsHod.id,
      appointedByUserId: appointer.id,
      reason: 'HOD on leave',
    });

    const result = await positionBackfillService.runBackfill(pool, { collegeIds: [collegeId] });
    const entry = result.results.find((r) => r.collegeId === collegeId);
    assert.equal(entry.departments[0].status, 'created');
    assert.equal(entry.departments[0].source, 'hod-in-charge');
    assert.equal(entry.departments[0].userId, facultyActingAsHod.id);

    const occupant = await pool.query(
      `SELECT po.user_id FROM position_occupants po
       JOIN positions p ON p.id = (SELECT position_id FROM position_accounts WHERE id = po.position_account_id)
       WHERE p.college_id = $1 AND p.level = 3`,
      [collegeId],
    );
    assert.equal(occupant.rows[0].user_id, facultyActingAsHod.id);
  });

  await t.test('a department with neither an active HOD nor an HOD-in-Charge is reported and skipped, not an error', async () => {
    const collegeId = `bf${suffix}c`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    await insertUser(pool, { collegeId, username: 'principal', role: 'principal' });
    await insertDepartment(pool, collegeId, 'Mech');

    const result = await positionBackfillService.runBackfill(pool, { collegeIds: [collegeId] });
    const entry = result.results.find((r) => r.collegeId === collegeId);
    assert.equal(entry.departments[0].status, 'no-active-hod');

    const positions = await pool.query('SELECT level FROM positions WHERE college_id = $1', [collegeId]);
    assert.deepEqual(positions.rows.map((r) => r.level), [1], 'only the principal position is created, no Level 3 row');
  });

  await t.test('one college failing never affects another college in the same run (per-college transaction isolation)', async () => {
    const badCollegeId = `bf${suffix}d`;
    const goodCollegeId = `bf${suffix}e`;
    collegeIds.push(badCollegeId, goodCollegeId);
    await insertCollege(pool, badCollegeId);
    await insertCollege(pool, goodCollegeId);
    await insertUser(pool, { collegeId: badCollegeId, username: 'principal', role: 'principal' });
    await insertUser(pool, { collegeId: goodCollegeId, username: 'principal', role: 'principal' });

    // Force a mid-transaction failure for badCollegeId only, after its
    // position row is already written but before the transaction
    // commits — proves the whole college's work rolls back together,
    // not that the code path is simply never reached.
    const originalCreatePositionAccount = positionRepository.createPositionAccount.bind(positionRepository);
    t.mock.method(positionRepository, 'createPositionAccount', async (client, args) => {
      if (args.collegeId === badCollegeId) {
        throw new Error('Simulated mid-transaction failure for isolation test');
      }
      return originalCreatePositionAccount(client, args);
    });

    const result = await positionBackfillService.runBackfill(pool, { collegeIds: [badCollegeId, goodCollegeId] });
    const badEntry = result.results.find((r) => r.collegeId === badCollegeId);
    const goodEntry = result.results.find((r) => r.collegeId === goodCollegeId);

    assert.ok(badEntry.error, 'bad college reports an error instead of throwing out of the whole run');
    assert.equal(goodEntry.principal.status, 'created');
    assert.equal(goodEntry.migrationState, 'BACKFILLED');

    const badCollegeState = await pool.query('SELECT migration_state FROM colleges WHERE college_id = $1', [badCollegeId]);
    assert.equal(badCollegeState.rows[0].migration_state, 'LEGACY', 'failed college is rolled back, left LEGACY, not half-migrated');

    const badCollegePositions = await pool.query('SELECT * FROM positions WHERE college_id = $1', [badCollegeId]);
    assert.equal(badCollegePositions.rows.length, 0, 'failed college has zero rows, transaction fully rolled back');
  });

  await t.test('unbackfill deletes only rows tagged with the given batch id and restores LEGACY, leaving unrelated data untouched', async () => {
    const collegeId = `bf${suffix}f`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const principal = await insertUser(pool, { collegeId, username: 'principal', role: 'principal' });

    const backfillResult = await positionBackfillService.runBackfill(pool, { collegeIds: [collegeId] });
    const entry = backfillResult.results.find((r) => r.collegeId === collegeId);
    assert.equal(entry.principal.status, 'created');

    // Unrelated data created after backfill, for the same college —
    // must survive unbackfill untouched (this is the whole reason
    // ADR-025 requires batch-id-scoped delete instead of a blind
    // delete by college_id).
    const unrelatedPosition = await pool.query(
      `INSERT INTO positions (college_id, level, title, created_by)
       VALUES ($1, 2, 'Manually Added Coordinator', $2) RETURNING id`,
      [collegeId, principal.id],
    );

    const unbackfillResult = await positionBackfillService.runUnbackfill(pool, { batchId: backfillResult.batchId });
    assert.equal(unbackfillResult.positionsDeleted, 1);
    assert.equal(unbackfillResult.accountsDeleted, 1);
    assert.equal(unbackfillResult.occupantsDeleted, 1);
    assert.ok(unbackfillResult.collegeIds.includes(collegeId));

    const remainingPositions = await pool.query('SELECT id FROM positions WHERE college_id = $1', [collegeId]);
    assert.equal(remainingPositions.rows.length, 1);
    assert.equal(remainingPositions.rows[0].id, unrelatedPosition.rows[0].id, 'the unrelated, untagged position must survive');

    const collegeState = await pool.query('SELECT migration_state FROM colleges WHERE college_id = $1', [collegeId]);
    assert.equal(collegeState.rows[0].migration_state, 'LEGACY');
  });

  await t.test('unbackfill refuses to touch a college that is not currently BACKFILLED (fails loudly, deletes nothing)', async () => {
    const collegeId = `bf${suffix}g`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    await insertUser(pool, { collegeId, username: 'principal', role: 'principal' });

    const backfillResult = await positionBackfillService.runBackfill(pool, { collegeIds: [collegeId] });
    assert.equal(backfillResult.results.find((r) => r.collegeId === collegeId).principal.status, 'created');

    // Simulate the college having moved further through the migration
    // (e.g. into SHADOW) since it was backfilled.
    await pool.query("UPDATE colleges SET migration_state = 'SHADOW' WHERE college_id = $1", [collegeId]);

    await assert.rejects(
      () => positionBackfillService.runUnbackfill(pool, { batchId: backfillResult.batchId }),
      /not BACKFILLED/,
    );

    const positions = await pool.query('SELECT id FROM positions WHERE college_id = $1', [collegeId]);
    assert.equal(positions.rows.length, 1, 'refused unbackfill must not delete anything');

    const collegeState = await pool.query('SELECT migration_state FROM colleges WHERE college_id = $1', [collegeId]);
    assert.equal(collegeState.rows[0].migration_state, 'SHADOW', 'state is untouched by the refused unbackfill');
  });

  await t.test('default (no collegeIds override) scope is every college in LEGACY state — resumability wiring', async () => {
    // The other subtests above all pass an explicit collegeIds scope so
    // this suite never sweeps up colleges other, concurrently-running
    // test files are creating/deleting in the same shared database.
    // This test instead verifies the underlying "every LEGACY college"
    // query directly at the repository level — the exact query
    // runBackfill(pool) (no override) uses by default — without
    // actually invoking the unbounded sweep here.
    const collegeMigrationRepository = require('../src/repositories/collegeMigrationRepository');
    const collegeId = `bf${suffix}h`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);

    const legacyIds = await collegeMigrationRepository.findCollegesByMigrationState(pool, 'LEGACY');
    assert.ok(legacyIds.includes(collegeId), 'a freshly-created college is picked up by the same query the unscoped default uses');

    await positionBackfillService.runBackfill(pool, { collegeIds: [collegeId] });
    const legacyIdsAfter = await collegeMigrationRepository.findCollegesByMigrationState(pool, 'LEGACY');
    assert.ok(!legacyIdsAfter.includes(collegeId), 'a backfilled college is no longer returned as LEGACY — this is what makes resumability free');
  });
});
