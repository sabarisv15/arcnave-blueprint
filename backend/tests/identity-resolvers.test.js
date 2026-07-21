'use strict';

// Coverage for Identity-Migration-Plan.md Phase 3's internal resolver
// modules (services/identity/*Resolver.js) and the identityService
// façade that composes them — against real seeded position data, same
// MIGRATION_DATABASE_URL (bypasses RLS) fixture pattern
// position-schema.test.js and position-backfill-service.test.js
// already use for this exact reason (this suite is inherently
// cross-tenant/cross-role: it seeds positions/accounts/occupants
// directly rather than going through any tenant-scoped route).
//
// Deliberately tests the resolvers both individually (positionResolver
// alone, moduleResolver alone, ...) and the façade's composed output
// (identityService.resolveCapabilities), since the façade's contract
// (ADR-022) is what Phase 5/6 actually depend on — the individual
// resolver tests exist to make failures easy to localize, not because
// anything outside identityService is meant to be called directly by a
// route or AI tool.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const positionRepository = require('../src/repositories/positionRepository');
const positionResolver = require('../src/services/identity/positionResolver');
const moduleResolver = require('../src/services/identity/moduleResolver');
const departmentResolver = require('../src/services/identity/departmentResolver');
const assignmentResolver = require('../src/services/identity/assignmentResolver');
const visibilityResolver = require('../src/services/identity/visibilityResolver');
const identityService = require('../src/services/identityService');
const { SCOPE_LEVELS } = require('../src/constants/scopeLevels');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

async function insertCollege(pool, collegeId) {
  await pool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)', [collegeId]);
}

async function insertUser(pool, collegeId, username, role = 'staff') {
  const result = await pool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, $2, $2 || '@example.test', 'x', $3, true) RETURNING id`,
    [collegeId, username, role],
  );
  return result.rows[0].id;
}

async function insertDepartment(pool, collegeId, name) {
  const result = await pool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [collegeId, name]);
  return result.rows[0].id;
}

async function makePosition(pool, { collegeId, level, title, createdBy }) {
  const position = await positionRepository.createPosition(pool, {
    collegeId, level, title, createdBy,
  });
  const account = await positionRepository.createPositionAccount(pool, {
    collegeId, positionId: position.id, officialEmail: `${title}@example.edu`, passwordHash: 'x',
  });
  return { position, account };
}

async function occupy(pool, { collegeId, accountId, userId }) {
  return positionRepository.createPositionOccupant(pool, {
    collegeId, positionAccountId: accountId, userId, assignedBy: userId,
  });
}

async function cleanup(pool, collegeId) {
  await pool.query('DELETE FROM position_department_assignments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_module_assignments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_occupants WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM position_accounts WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM positions WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM staff WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM classes WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM departments WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await pool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

test('identity resolvers (Phase 3)', async (t) => {
  const pool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeIds = [];

  t.after(async () => {
    for (const collegeId of collegeIds) {
      // eslint-disable-next-line no-await-in-loop -- test teardown, small fixed set
      await cleanup(pool, collegeId);
    }
    await pool.end();
  });

  await t.test('positionResolver: a user with no positions resolves to an empty list', async () => {
    const collegeId = `idr${suffix}a`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const userId = await insertUser(pool, collegeId, 'nobody');

    const positions = await positionResolver.resolveActivePositions(pool, { collegeId, userId });
    assert.deepEqual(positions, []);
  });

  await t.test('positionResolver: resolves the position a user actively occupies, and stops after revocation', async () => {
    const collegeId = `idr${suffix}b`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const principalUserId = await insertUser(pool, collegeId, 'principal1', 'principal');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: principalUserId,
    });
    const occupant = await occupy(pool, { collegeId, accountId: account.id, userId: principalUserId });

    const positions = await positionResolver.resolveActivePositions(pool, { collegeId, userId: principalUserId });
    assert.equal(positions.length, 1);
    assert.equal(positions[0].positionId, position.id);
    assert.equal(positions[0].level, 1);
    assert.equal(positions[0].positionAccountId, account.id);

    await positionRepository.revokePositionOccupant(pool, occupant.id, { revokedBy: principalUserId });
    const afterRevoke = await positionResolver.resolveActivePositions(pool, { collegeId, userId: principalUserId });
    assert.deepEqual(afterRevoke, []);
  });

  await t.test('moduleResolver / departmentResolver: resolve only active assignments for a position', async () => {
    const collegeId = `idr${suffix}c`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const hodUserId = await insertUser(pool, collegeId, 'hod1', 'hod');
    const deptId = await insertDepartment(pool, collegeId, 'CSE');
    const { position } = await makePosition(pool, {
      collegeId, level: 3, title: 'HOD CSE', createdBy: hodUserId,
    });

    assert.deepEqual(await moduleResolver.resolveOwnedModules(pool, position.id), []);
    assert.deepEqual(await departmentResolver.resolveMappedDepartments(pool, position.id), []);

    const moduleAssignment = await positionRepository.createPositionModuleAssignment(pool, {
      collegeId, positionId: position.id, moduleKey: 'attendance', assignedBy: hodUserId,
    });
    const deptAssignment = await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId, positionId: position.id, departmentId: deptId, assignedBy: hodUserId,
    });

    assert.deepEqual(await moduleResolver.resolveOwnedModules(pool, position.id), ['attendance']);
    assert.deepEqual(await departmentResolver.resolveMappedDepartments(pool, position.id), [deptId]);

    await positionRepository.revokePositionModuleAssignment(pool, moduleAssignment.id, { revokedBy: hodUserId });
    await positionRepository.revokePositionDepartmentAssignment(pool, deptAssignment.id, { revokedBy: hodUserId });

    assert.deepEqual(await moduleResolver.resolveOwnedModules(pool, position.id), []);
    assert.deepEqual(await departmentResolver.resolveMappedDepartments(pool, position.id), []);
  });

  await t.test('assignmentResolver: resolves the current occupant, null once revoked', async () => {
    const collegeId = `idr${suffix}d`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const userId = await insertUser(pool, collegeId, 'occ1', 'hod');
    const { account } = await makePosition(pool, {
      collegeId, level: 3, title: 'HOD ECE', createdBy: userId,
    });

    assert.equal(await assignmentResolver.resolveCurrentOccupantUserId(pool, account.id), null);

    const occupant = await occupy(pool, { collegeId, accountId: account.id, userId });
    assert.equal(await assignmentResolver.resolveCurrentOccupantUserId(pool, account.id), userId);

    await positionRepository.revokePositionOccupant(pool, occupant.id, { revokedBy: userId });
    assert.equal(await assignmentResolver.resolveCurrentOccupantUserId(pool, account.id), null);
  });

  await t.test('visibilityResolver: Level 1 -> college scope, Level 3 -> department scope, no position -> self_assigned', async () => {
    const collegeId = `idr${suffix}e`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);

    const principalUserId = await insertUser(pool, collegeId, 'principal2', 'principal');
    const principalPosition = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: principalUserId,
    });
    await occupy(pool, { collegeId, accountId: principalPosition.account.id, userId: principalUserId });
    const principalPositions = await positionResolver.resolveActivePositions(pool, { collegeId, userId: principalUserId });

    const principalScope = await visibilityResolver.resolveVisibilityScope(pool, {
      userId: principalUserId,
      positions: principalPositions,
      resolveDepartmentIds: (positionId) => departmentResolver.resolveMappedDepartments(pool, positionId),
    });
    assert.equal(principalScope.scopeLevel, SCOPE_LEVELS.COLLEGE);
    assert.deepEqual(principalScope.departmentIds, []);

    const hodUserId = await insertUser(pool, collegeId, 'hod2', 'hod');
    const deptId = await insertDepartment(pool, collegeId, 'ECE');
    const hodPosition = await makePosition(pool, {
      collegeId, level: 3, title: 'HOD ECE', createdBy: hodUserId,
    });
    await occupy(pool, { collegeId, accountId: hodPosition.account.id, userId: hodUserId });
    await positionRepository.createPositionDepartmentAssignment(pool, {
      collegeId, positionId: hodPosition.position.id, departmentId: deptId, assignedBy: hodUserId,
    });
    const hodPositions = await positionResolver.resolveActivePositions(pool, { collegeId, userId: hodUserId });

    const hodScope = await visibilityResolver.resolveVisibilityScope(pool, {
      userId: hodUserId,
      positions: hodPositions,
      resolveDepartmentIds: (positionId) => departmentResolver.resolveMappedDepartments(pool, positionId),
    });
    assert.equal(hodScope.scopeLevel, SCOPE_LEVELS.DEPARTMENT);
    assert.deepEqual(hodScope.departmentIds, [deptId]);

    const staffUserId = await insertUser(pool, collegeId, 'staff1', 'staff');
    const staffScope = await visibilityResolver.resolveVisibilityScope(pool, {
      userId: staffUserId,
      positions: [],
      resolveDepartmentIds: async () => [],
    });
    assert.equal(staffScope.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);
    assert.deepEqual(staffScope.assignedClassIds, []);
  });

  await t.test('identityService.resolveCapabilities: composes all five resolvers into one comparable structure', async () => {
    const collegeId = `idr${suffix}f`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const principalUserId = await insertUser(pool, collegeId, 'principal3', 'principal');
    const { position, account } = await makePosition(pool, {
      collegeId, level: 1, title: 'Principal', createdBy: principalUserId,
    });
    await occupy(pool, { collegeId, accountId: account.id, userId: principalUserId });
    await positionRepository.createPositionModuleAssignment(pool, {
      collegeId, positionId: position.id, moduleKey: 'finance', assignedBy: principalUserId,
    });

    const capabilities = await identityService.resolveCapabilities(pool, { userId: principalUserId, collegeId });

    assert.equal(capabilities.effectiveRole, 'principal');
    assert.equal(capabilities.scopeLevel, SCOPE_LEVELS.COLLEGE);
    assert.equal(capabilities.positions.length, 1);
    assert.equal(capabilities.positions[0].positionId, position.id);
    assert.deepEqual(capabilities.positions[0].moduleKeys, ['finance']);
    assert.equal(capabilities.positions[0].currentOccupantUserId, principalUserId);
  });

  await t.test('identityService.resolveCapabilities: a user with no active position resolves as staff/self_assigned, not an error', async () => {
    const collegeId = `idr${suffix}g`;
    collegeIds.push(collegeId);
    await insertCollege(pool, collegeId);
    const userId = await insertUser(pool, collegeId, 'staff2', 'staff');

    const capabilities = await identityService.resolveCapabilities(pool, { userId, collegeId });
    assert.equal(capabilities.effectiveRole, 'staff');
    assert.equal(capabilities.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);
    assert.deepEqual(capabilities.positions, []);
  });
});
