'use strict';

// Constraint tests for Identity-Migration-Plan.md Phase 1 / ADR-021's
// additive schema (1756900000000_position-schema.js) — positions,
// position_accounts, position_occupants, position_module_assignments,
// position_department_assignments. Nothing reads these tables in the
// app yet (no identityService/resolver — that's Phase 3+, out of
// scope here); this suite exists purely to prove the DB-level
// invariants the migration's own exit criteria name:
//   - can't have two position_accounts rows for the same position
//   - can't have two ACTIVE occupants for the same position_account
//   - can't double-assign a module (one active position per
//     college+module)
//   - one active position per department
//
// Runs against a real Postgres via MIGRATION_DATABASE_URL (arcnave_admin,
// bypasses RLS — same "seed/verify fixture data directly" role every
// other *-schema-adjacent integration test in this suite already uses
// for this exact purpose, per config.js's own module comment). This is
// deliberately not RLS-focused (rls-tenant-isolation.test.js already
// owns that concern) — these are plain UNIQUE/CHECK constraints,
// enforced identically regardless of which role holds the connection.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const positionRepository = require('../src/repositories/positionRepository');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

async function seedFixtures(pool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `pos${suffix}`;
  await pool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)',
    [collegeId],
  );
  const userResult = await pool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'creator', 'creator@example.com', 'x', 'principal', true)
     RETURNING id`,
    [collegeId],
  );
  const deptResult = await pool.query(
    'INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id',
    [collegeId, `CSE-${suffix}`],
  );
  return { collegeId, createdBy: userResult.rows[0].id, departmentId: deptResult.rows[0].id };
}

async function cleanupFixtures(pool, collegeId) {
  await pool.query('DELETE FROM position_department_assignments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_module_assignments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_occupants WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_accounts WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM positions WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM departments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

test('position schema constraints (Phase 1)', async (t) => {
  const pool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const fixtures = await seedFixtures(pool);

  t.after(async () => {
    await cleanupFixtures(pool, fixtures.collegeId);
    await pool.end();
  });

  await t.test('level must be between 1 and 4', async () => {
    await assert.rejects(
      () => positionRepository.createPosition(pool, {
        collegeId: fixtures.collegeId, level: 5, title: 'Bad Level', createdBy: fixtures.createdBy,
      }),
      /violates check constraint/,
    );
  });

  await t.test('a position can only ever have one position_accounts row', async () => {
    const position = await positionRepository.createPosition(pool, {
      collegeId: fixtures.collegeId, level: 1, title: 'Principal', createdBy: fixtures.createdBy,
    });

    const account = await positionRepository.createPositionAccount(pool, {
      collegeId: fixtures.collegeId,
      positionId: position.id,
      officialEmail: 'principal@example.edu',
      passwordHash: 'hashed',
    });
    assert.ok(account.id);

    await assert.rejects(
      () => positionRepository.createPositionAccount(pool, {
        collegeId: fixtures.collegeId,
        positionId: position.id,
        officialEmail: 'principal-2@example.edu',
        passwordHash: 'hashed',
      }),
      /duplicate key value violates unique constraint/,
    );
  });

  await t.test('at most one active occupant per position_account, revoke-then-reassign works', async () => {
    const position = await positionRepository.createPosition(pool, {
      collegeId: fixtures.collegeId, level: 3, title: 'HOD', createdBy: fixtures.createdBy,
    });
    const account = await positionRepository.createPositionAccount(pool, {
      collegeId: fixtures.collegeId,
      positionId: position.id,
      officialEmail: 'hod@example.edu',
      passwordHash: 'hashed',
    });

    const occupantA = await positionRepository.createPositionOccupant(pool, {
      collegeId: fixtures.collegeId,
      positionAccountId: account.id,
      userId: fixtures.createdBy,
      assignedBy: fixtures.createdBy,
    });
    assert.ok(occupantA.id);
    assert.equal(occupantA.revoked_at, null);

    await assert.rejects(
      () => positionRepository.createPositionOccupant(pool, {
        collegeId: fixtures.collegeId,
        positionAccountId: account.id,
        userId: fixtures.createdBy,
        assignedBy: fixtures.createdBy,
      }),
      /duplicate key value violates unique constraint/,
    );

    const revoked = await positionRepository.revokePositionOccupant(pool, occupantA.id, {
      revokedBy: fixtures.createdBy,
    });
    assert.ok(revoked.revoked_at);

    // Now that the only active occupant is revoked, a second
    // occupant (a real reassignment) succeeds — and the first row is
    // never deleted, only marked revoked (append-only, matching
    // hod_in_charge_appointments's own precedent).
    const occupantB = await positionRepository.createPositionOccupant(pool, {
      collegeId: fixtures.collegeId,
      positionAccountId: account.id,
      userId: fixtures.createdBy,
      assignedBy: fixtures.createdBy,
    });
    assert.ok(occupantB.id);
    assert.notEqual(occupantB.id, occupantA.id);

    const stillThere = await pool.query('SELECT * FROM position_occupants WHERE id = $1', [occupantA.id]);
    assert.equal(stillThere.rows.length, 1, 'the revoked occupant row must still exist, never deleted');
  });

  await t.test('a module can only be actively assigned to one position per college at a time', async () => {
    const positionA = await positionRepository.createPosition(pool, {
      collegeId: fixtures.collegeId, level: 2, title: 'Exam Coordinator', createdBy: fixtures.createdBy,
    });
    const positionB = await positionRepository.createPosition(pool, {
      collegeId: fixtures.collegeId, level: 2, title: 'Another Coordinator', createdBy: fixtures.createdBy,
    });

    const assignmentA = await positionRepository.createPositionModuleAssignment(pool, {
      collegeId: fixtures.collegeId, positionId: positionA.id, moduleKey: 'examination', assignedBy: fixtures.createdBy,
    });
    assert.ok(assignmentA.id);

    await assert.rejects(
      () => positionRepository.createPositionModuleAssignment(pool, {
        collegeId: fixtures.collegeId, positionId: positionB.id, moduleKey: 'examination', assignedBy: fixtures.createdBy,
      }),
      /duplicate key value violates unique constraint/,
    );

    await positionRepository.revokePositionModuleAssignment(pool, assignmentA.id, { revokedBy: fixtures.createdBy });

    const assignmentB = await positionRepository.createPositionModuleAssignment(pool, {
      collegeId: fixtures.collegeId, positionId: positionB.id, moduleKey: 'examination', assignedBy: fixtures.createdBy,
    });
    assert.ok(assignmentB.id);
  });

  await t.test('a department can only have one active position mapping at a time', async () => {
    const positionA = await positionRepository.createPosition(pool, {
      collegeId: fixtures.collegeId, level: 3, title: 'HOD A', createdBy: fixtures.createdBy,
    });
    const positionB = await positionRepository.createPosition(pool, {
      collegeId: fixtures.collegeId, level: 3, title: 'HOD B', createdBy: fixtures.createdBy,
    });

    const mappingA = await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId: fixtures.collegeId, positionId: positionA.id, departmentId: fixtures.departmentId, assignedBy: fixtures.createdBy,
    });
    assert.ok(mappingA.id);

    await assert.rejects(
      () => positionRepository.createPositionDepartmentAssignment(pool, {
        collegeId: fixtures.collegeId, positionId: positionB.id, departmentId: fixtures.departmentId, assignedBy: fixtures.createdBy,
      }),
      /duplicate key value violates unique constraint/,
    );

    await positionRepository.revokePositionDepartmentAssignment(pool, mappingA.id, { revokedBy: fixtures.createdBy });

    const mappingB = await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId: fixtures.collegeId, positionId: positionB.id, departmentId: fixtures.departmentId, assignedBy: fixtures.createdBy,
    });
    assert.ok(mappingB.id);
  });
});
