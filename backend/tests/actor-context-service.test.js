'use strict';

// Unit tests for actorContextService.buildActorContext — no live
// Postgres: classRepository/facultyAllocationRepository/staffService
// are stubbed via node:test's built-in mock, same technique
// visibility-service.test.js already uses.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const staffService = require('../src/services/staffService');
const { buildActorContext } = require('../src/services/actorContextService');
const { SCOPE_LEVELS } = require('../src/constants/scopeLevels');

test('actorContextService.buildActorContext', async (t) => {
  await t.test('staff (tutor + faculty-allocated) resolves self_assigned scope and the union of both classes', async () => {
    const tutorMock = t.mock.method(classRepository, 'findByTutorUserId', async () => ({ id: 'class-a' }));
    t.after(() => tutorMock.mock.restore());
    const allocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => [
      { class_id: 'class-b' },
    ]);
    t.after(() => allocMock.mock.restore());

    const ctx = await buildActorContext({}, { actorId: 'staff-1', tenantId: 'college-1', role: 'staff' });

    assert.equal(ctx.actorId, 'staff-1');
    assert.equal(ctx.tenantId, 'college-1');
    assert.equal(ctx.role, 'staff');
    assert.equal(ctx.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);
    assert.deepEqual(ctx.departmentIds, []);
    assert.deepEqual([...ctx.assignedClassIds].sort(), ['class-a', 'class-b']);
    assert.deepEqual(ctx.campusIds, ['college-1']);
  });

  await t.test('staff with no tutor class and no allocations resolves an empty assignedClassIds', async () => {
    const tutorMock = t.mock.method(classRepository, 'findByTutorUserId', async () => null);
    t.after(() => tutorMock.mock.restore());
    const allocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => []);
    t.after(() => allocMock.mock.restore());

    const ctx = await buildActorContext({}, { actorId: 'staff-2', tenantId: 'college-1', role: 'staff' });

    assert.equal(ctx.scopeLevel, SCOPE_LEVELS.SELF_ASSIGNED);
    assert.deepEqual(ctx.assignedClassIds, []);
  });

  await t.test('hod resolves department scope and their one real (verified) department', async () => {
    const deptMock = t.mock.method(staffService, 'findHodDepartmentId', async () => 'dept-1');
    t.after(() => deptMock.mock.restore());

    const ctx = await buildActorContext({}, { actorId: 'hod-1', tenantId: 'college-1', role: 'hod' });

    assert.equal(ctx.scopeLevel, SCOPE_LEVELS.DEPARTMENT);
    assert.deepEqual(ctx.departmentIds, ['dept-1']);
    assert.deepEqual(ctx.assignedClassIds, []);
  });

  await t.test('hod not verified as a real hod of anything resolves an empty departmentIds', async () => {
    const deptMock = t.mock.method(staffService, 'findHodDepartmentId', async () => null);
    t.after(() => deptMock.mock.restore());

    const ctx = await buildActorContext({}, { actorId: 'hod-2', tenantId: 'college-1', role: 'hod' });

    assert.equal(ctx.scopeLevel, SCOPE_LEVELS.DEPARTMENT);
    assert.deepEqual(ctx.departmentIds, []);
  });

  await t.test('principal resolves college scope with no department/class lookups performed', async () => {
    const tutorMock = t.mock.method(classRepository, 'findByTutorUserId', async () => {
      throw new Error('should not be called for a principal actor');
    });
    t.after(() => tutorMock.mock.restore());
    const deptMock = t.mock.method(staffService, 'findHodDepartmentId', async () => {
      throw new Error('should not be called for a principal actor');
    });
    t.after(() => deptMock.mock.restore());

    const ctx = await buildActorContext({}, { actorId: 'principal-1', tenantId: 'college-1', role: 'principal' });

    assert.equal(ctx.scopeLevel, SCOPE_LEVELS.COLLEGE);
    assert.deepEqual(ctx.departmentIds, []);
    assert.deepEqual(ctx.assignedClassIds, []);
    assert.deepEqual(ctx.campusIds, ['college-1']);
  });

  await t.test('a role with no scope-level mapping resolves scopeLevel null', async () => {
    const ctx = await buildActorContext({}, { actorId: 'admin-1', tenantId: 'college-1', role: 'unmapped_role' });

    assert.equal(ctx.scopeLevel, null);
    assert.deepEqual(ctx.departmentIds, []);
    assert.deepEqual(ctx.assignedClassIds, []);
  });

  await t.test('a null/undefined tenantId resolves an empty campusIds', async () => {
    const ctx = await buildActorContext({}, { actorId: 'admin-1', tenantId: null, role: 'unmapped_role' });
    assert.deepEqual(ctx.campusIds, []);
  });
});
