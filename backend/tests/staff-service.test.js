'use strict';

// Unit tests for StaffService's pure business-logic paths — these
// need no live Postgres at all: staffRepository and
// auditLogRepository are stubbed via node:test's built-in mock (works
// here because staffService always calls e.g.
// `staffRepository.create(...)` as a fresh property lookup on the
// shared module object, never a destructured local reference, so
// replacing the export before the call takes effect).
//
// What's deliberately NOT here: an actual staff_user_id_key /
// staff_college_id_staff_code_key / staff_user_id_fkey violation
// reaching its domain error end-to-end. That needs a real Postgres
// 23505/23503 from the live constraints, not a hand-thrown err.code +
// err.constraint — verified manually against the real docker-compose
// Postgres, not as a committed test (no staffRepository tests exist
// yet either).

const test = require('node:test');
const assert = require('node:assert/strict');
const staffRepository = require('../src/repositories/staffRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const workflowService = require('../src/services/workflowService');
const authService = require('../src/services/authService');
const notificationService = require('../src/services/notificationService');
const staffService = require('../src/services/staffService');

test('StaffService validation and audit logging (no DB)', async (t) => {
  await t.test('createStaff rejects a missing userId without touching the DB', async () => {
    const createMock = t.mock.method(staffRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', fullName: 'Alice', userId: undefined }),
      staffService.StaffValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStaff rejects a missing fullName without touching the DB', async () => {
    const createMock = t.mock.method(staffRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'u1' }),
      staffService.StaffValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStaff drops an aadhaar-shaped field instead of passing it through', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffService.createStaff({}, {
      collegeId: 'c1',
      userId: 'u1',
      fullName: 'Alice',
      aadhaarNumber: '1234-5678-9012',
    });

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal('aadhaarNumber' in passedFields, false);
  });

  await t.test('createStaff does not require staffCode', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.doesNotReject(() =>
      staffService.createStaff({}, { collegeId: 'c1', userId: 'u1', fullName: 'Alice' }));
  });

  await t.test('createStaff attributes the audit entry to actorUserId, not the new staff row\'s own userId', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffService.createStaff(
      {},
      { collegeId: 'c1', userId: 'subject-user', fullName: 'Alice' },
      { actorUserId: 'actor-user' },
    );

    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'actor-user');
  });

  await t.test('createStaff maps a staff_user_id_key violation to StaffUserConflictError', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "staff_user_id_key"');
      err.code = '23505';
      err.constraint = 'staff_user_id_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'u1', fullName: 'Alice' }),
      staffService.StaffUserConflictError,
    );
  });

  await t.test('createStaff maps a staff_college_id_staff_code_key violation to StaffCodeConflictError', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "staff_college_id_staff_code_key"');
      err.code = '23505';
      err.constraint = 'staff_college_id_staff_code_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'u1', fullName: 'Alice', staffCode: 'CSE-01' }),
      staffService.StaffCodeConflictError,
    );
  });

  await t.test('createStaff maps a staff_user_id_fkey violation to StaffUserNotFoundError', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      const err = new Error('insert or update on table "staff" violates foreign key constraint "staff_user_id_fkey"');
      err.code = '23503';
      err.constraint = 'staff_user_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'missing-user', fullName: 'Alice' }),
      staffService.StaffUserNotFoundError,
    );
  });

  await t.test('createStaff lets a non-conflict repository error pass through unchanged', async () => {
    const boom = new Error('connection lost');
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      throw boom;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'u1', fullName: 'Alice' }),
      (err) => err === boom,
    );
  });

  await t.test('updateStaff with no recognized fields does not write an audit entry', async () => {
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffService.updateStaff({}, 'staff-id', { aadhaarNumber: 'x' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateStaff with a recognized field writes an audit entry', async () => {
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffService.updateStaff({}, 'staff-id', { designation: 'Associate Professor' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_updated');
  });

  await t.test('updateStaff against a nonexistent id does not write an audit entry', async () => {
    const updateMock = t.mock.method(staffRepository, 'update', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.updateStaff({}, 'missing-id', { designation: 'Professor' }, { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateStaff maps a staff_code conflict on update to StaffCodeConflictError', async () => {
    const updateMock = t.mock.method(staffRepository, 'update', async () => {
      const err = new Error('duplicate key value violates unique constraint "staff_college_id_staff_code_key"');
      err.code = '23505';
      err.constraint = 'staff_college_id_staff_code_key';
      throw err;
    });
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => staffService.updateStaff({}, 'staff-id', { staffCode: 'CSE-01' }, { userId: 'u1' }),
      staffService.StaffCodeConflictError,
    );
  });

  await t.test('removeStaff on a nonexistent id is a no-op, no audit entry', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => null);
    const removeMock = t.mock.method(staffRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.removeStaff({}, 'missing-id', { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeStaff on an existing id deletes and writes an audit entry', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({ id, college_id: 'c1' }));
    const removeMock = t.mock.method(staffRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.removeStaff({}, 'staff-id', { userId: 'u1' });

    assert.deepEqual(result, { id: 'staff-id', college_id: 'c1' });
    assert.equal(removeMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_removed');
  });
});

// Module 8 final slice: approveStaffRegistration's terminal Approved
// cascade (staff_code assignment -> authService.activateUser ->
// notificationService.sendStaffCredentialsEmail). Real HOD/Principal
// resolution and the full multi-step workflow chain itself are already
// live-verified (Module 8's third slice) against a real Postgres —
// this file only covers the cascade's own new logic, mocked, same
// technique as every other *-service.test.js in this codebase.
test('StaffService registration-approval cascade (no DB)', async (t) => {
  await t.test('approveStaffRegistration on a non-terminal (still Pending) resolution does not touch staff_code/activation/email', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({ id, college_id: 'c1', user_id: 'user-1' }));
    const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Pending', current_step: 2 }));
    const updateMock = t.mock.method(staffRepository, 'update');
    const activateMock = t.mock.method(authService, 'activateUser');
    const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail');
    t.after(() => {
      findMock.mock.restore();
      pendingMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      activateMock.mock.restore();
      emailMock.mock.restore();
    });

    const result = await staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'hod-1' });

    assert.equal(result.workflowRequest.status, 'Pending');
    assert.equal(updateMock.mock.callCount(), 0);
    assert.equal(activateMock.mock.callCount(), 0);
    assert.equal(emailMock.mock.callCount(), 0);
  });

  await t.test('approveStaffRegistration on the terminal Approved resolution assigns a staff_code, activates the user, and emails credentials', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({ id, college_id: 'c1', user_id: 'user-1' }));
    const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Approved', current_step: 2 }));
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id, fields) => ({ id, college_id: 'c1', user_id: 'user-1', staff_code: fields.staffCode }));
    const activateMock = t.mock.method(authService, 'activateUser', async () => ({
      user: { id: 'user-1', username: 'jdoe', email: 'jdoe@college.edu' },
      plainPassword: 'temp-pass-123',
    }));
    const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail', async () => ({ status: 'stubbed' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      pendingMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      activateMock.mock.restore();
      emailMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'principal-1' });

    assert.match(result.staff.staff_code, /^STF-\d{4}-[0-9A-F]{6}$/);
    assert.equal(updateMock.mock.callCount(), 1);

    assert.equal(activateMock.mock.callCount(), 1);
    assert.equal(activateMock.mock.calls[0].arguments[1], 'user-1');
    assert.equal(activateMock.mock.calls[0].arguments[2].activatedBy, 'principal-1');

    assert.equal(emailMock.mock.callCount(), 1);
    const emailArgs = emailMock.mock.calls[0].arguments[1];
    assert.equal(emailArgs.to, 'jdoe@college.edu');
    assert.equal(emailArgs.username, 'jdoe');
    assert.equal(emailArgs.password, 'temp-pass-123');
    assert.equal(emailArgs.staffCode, result.staff.staff_code);

    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_activated');
  });

  await t.test('assignStaffCode (via approveStaffRegistration) retries past a staff_code collision', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({ id, college_id: 'c1', user_id: 'user-1' }));
    const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Approved', current_step: 1 }));
    let attempts = 0;
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id, fields) => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('duplicate key value violates unique constraint "staff_college_id_staff_code_key"');
        err.code = '23505';
        err.constraint = 'staff_college_id_staff_code_key';
        throw err;
      }
      return { id, college_id: 'c1', user_id: 'user-1', staff_code: fields.staffCode };
    });
    const activateMock = t.mock.method(authService, 'activateUser', async () => ({
      user: { id: 'user-1', username: 'jdoe', email: 'jdoe@college.edu' },
      plainPassword: 'temp-pass-123',
    }));
    const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail', async () => ({ status: 'stubbed' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      pendingMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      activateMock.mock.restore();
      emailMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'principal-1' });

    assert.equal(attempts, 3);
    assert.ok(result.staff.staff_code);
  });

  await t.test('approveStaffRegistration lets workflowService.approveRequest errors (e.g. self-approval) pass through unchanged, no cascade', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({ id, college_id: 'c1', user_id: 'user-1' }));
    const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => {
      throw new workflowService.WorkflowRequestSelfApprovalError('actor requested this workflow request');
    });
    const updateMock = t.mock.method(staffRepository, 'update');
    const activateMock = t.mock.method(authService, 'activateUser');
    t.after(() => {
      findMock.mock.restore();
      pendingMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      activateMock.mock.restore();
    });

    await assert.rejects(
      () => staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'requester-1' }),
      workflowService.WorkflowRequestSelfApprovalError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
    assert.equal(activateMock.mock.callCount(), 0);
  });
});
