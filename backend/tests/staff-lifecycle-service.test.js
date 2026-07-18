'use strict';

// Unit tests for StaffService's deactivation + HOD In-Charge functions
// — no live Postgres needed: staffRepository/authService/
// facultyAllocationRepository/classRepository/hodInChargeRepository/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const staffRepository = require('../src/repositories/staffRepository');
const authService = require('../src/services/authService');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const classRepository = require('../src/repositories/classRepository');
const hodInChargeRepository = require('../src/repositories/hodInChargeRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const staffService = require('../src/services/staffService');

test('deactivateStaff', async (t) => {
  await t.test('rejects an unknown staff id', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'missing'),
      staffService.StaffDeactivationNotFoundError,
    );
  });

  await t.test('refuses while the staff member still has active faculty allocations', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => [{ id: 'alloc-1' }]);
    const deactivateMock = t.mock.method(authService, 'deactivateUser');
    t.after(() => {
      findMock.mock.restore();
      findAllocMock.mock.restore();
      deactivateMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'staff-1'),
      staffService.StaffDeactivationHasActiveDutiesError,
    );
    assert.equal(deactivateMock.mock.callCount(), 0);
  });

  await t.test('refuses while the staff member is still a class tutor', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => []);
    const findTutorClassMock = t.mock.method(classRepository, 'findByTutorUserId', async () => ({ id: 'class-1' }));
    const deactivateMock = t.mock.method(authService, 'deactivateUser');
    t.after(() => {
      findMock.mock.restore();
      findAllocMock.mock.restore();
      findTutorClassMock.mock.restore();
      deactivateMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.deactivateStaff({}, 'staff-1'),
      staffService.StaffDeactivationHasActiveDutiesError,
    );
    assert.equal(deactivateMock.mock.callCount(), 0);
  });

  await t.test('deactivates a staff member with no active duties, without deleting the staff row', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => ({ id: 'staff-1', college_id: 'c1', user_id: 'u1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => []);
    const findTutorClassMock = t.mock.method(classRepository, 'findByTutorUserId', async () => null);
    const removeMock = t.mock.method(staffRepository, 'remove');
    const deactivateMock = t.mock.method(authService, 'deactivateUser', async (client, userId) => ({ id: userId, is_active: false }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      findAllocMock.mock.restore();
      findTutorClassMock.mock.restore();
      removeMock.mock.restore();
      deactivateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.deactivateStaff({}, 'staff-1', { actorUserId: 'hod-1' });
    assert.equal(result.user.is_active, false);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_deactivated');
  });
});

test('appointHodInCharge / revokeHodInCharge / findHodForDepartment fallback', async (t) => {
  await t.test('rejects missing departmentId/facultyUserId', async () => {
    await assert.rejects(
      () => staffService.appointHodInCharge({}, null, null),
      staffService.HodInChargeValidationError,
    );
  });

  await t.test('creates an appointment and audit-logs it', async () => {
    const createMock = t.mock.method(hodInChargeRepository, 'create', async (client, fields) => ({ id: 'appt-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await staffService.appointHodInCharge({}, 'dept-1', 'faculty-1', { reason: 'HOD on leave' }, { actorUserId: 'principal-1', collegeId: 'c1' });
    assert.equal(result.id, 'appt-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'hod_in_charge_appointed');
  });

  await t.test('maps a duplicate active-appointment constraint violation', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'hod_in_charge_one_active_per_department' });
    const createMock = t.mock.method(hodInChargeRepository, 'create', async () => { throw err; });
    t.after(() => createMock.mock.restore());
    await assert.rejects(
      () => staffService.appointHodInCharge({}, 'dept-1', 'faculty-1', {}, { actorUserId: 'principal-1', collegeId: 'c1' }),
      staffService.HodInChargeAlreadyActiveError,
    );
  });

  await t.test('revokeHodInCharge on a nonexistent/already-revoked appointment throws', async () => {
    const revokeMock = t.mock.method(hodInChargeRepository, 'revoke', async () => null);
    t.after(() => revokeMock.mock.restore());
    await assert.rejects(
      () => staffService.revokeHodInCharge({}, 'appt-1'),
      staffService.StaffDeactivationNotFoundError,
    );
  });

  await t.test('findHodForDepartment returns the real HOD when one is active, never checking in-charge', async () => {
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({ id: 'staff-hod', user_id: 'hod-1' }));
    const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment');
    t.after(() => {
      findHodMock.mock.restore();
      findInChargeMock.mock.restore();
    });
    const result = await staffService.findHodForDepartment({}, 'c1', 'dept-1');
    assert.equal(result.user_id, 'hod-1');
    assert.equal(findInChargeMock.mock.callCount(), 0);
  });

  await t.test('findHodForDepartment falls back to an active HOD In-Charge appointee when no real HOD exists', async () => {
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => null);
    const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment', async () => ({ faculty_user_id: 'faculty-1' }));
    const findByUserIdMock = t.mock.method(staffRepository, 'findByUserId', async () => ({ id: 'staff-faculty', user_id: 'faculty-1' }));
    t.after(() => {
      findHodMock.mock.restore();
      findInChargeMock.mock.restore();
      findByUserIdMock.mock.restore();
    });
    const result = await staffService.findHodForDepartment({}, 'c1', 'dept-1');
    assert.equal(result.user_id, 'faculty-1');
  });

  await t.test('findHodForDepartment throws when neither a real HOD nor an in-charge appointee exists', async () => {
    const findHodMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => null);
    const findInChargeMock = t.mock.method(hodInChargeRepository, 'findActiveForDepartment', async () => null);
    t.after(() => {
      findHodMock.mock.restore();
      findInChargeMock.mock.restore();
    });
    await assert.rejects(
      () => staffService.findHodForDepartment({}, 'c1', 'dept-1'),
      staffService.StaffHodNotFoundError,
    );
  });
});
