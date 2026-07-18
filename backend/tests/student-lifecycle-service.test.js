'use strict';

// Unit tests for StudentService's lifecycle + semester-progression
// functions — no live Postgres needed: studentRepository/
// studentLifecycleEventRepository/staffService/workflowService/
// configurationService/auditLogRepository are stubbed via node:test's
// built-in mock, same technique as every other *-service.test.js file
// in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const studentRepository = require('../src/repositories/studentRepository');
const studentLifecycleEventRepository = require('../src/repositories/studentLifecycleEventRepository');
const staffService = require('../src/services/staffService');
const workflowService = require('../src/services/workflowService');
const configurationService = require('../src/services/configurationService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const studentService = require('../src/services/studentService');

test('updateStudentLifecycleStatus (direct, low-severity path)', async (t) => {
  await t.test('rejects a missing reason', async () => {
    await assert.rejects(
      () => studentService.updateStudentLifecycleStatus({}, 's1', { newStatus: 'Suspended' }),
      studentService.StudentLifecycleValidationError,
    );
  });

  await t.test('rejects an unrecognized status', async () => {
    await assert.rejects(
      () => studentService.updateStudentLifecycleStatus({}, 's1', { newStatus: 'Vacationing', reason: 'x' }),
      studentService.StudentLifecycleValidationError,
    );
  });

  await t.test('rejects an approval-required status outright', async () => {
    await assert.rejects(
      () => studentService.updateStudentLifecycleStatus({}, 's1', { newStatus: 'Dismissed', reason: 'misconduct' }),
      studentService.StudentLifecycleApprovalRequiredError,
    );
  });

  await t.test('records a lifecycle event and updates the status directly', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 's1', college_id: 'c1', lifecycle_status: 'Active' }));
    const createEventMock = t.mock.method(studentLifecycleEventRepository, 'create', async (client, fields) => fields);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      createEventMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.updateStudentLifecycleStatus({}, 's1', { newStatus: 'Suspended', reason: 'pending inquiry' }, { actorUserId: 'tutor-1' });
    assert.equal(createEventMock.mock.calls[0].arguments[1].previousStatus, 'Active');
    assert.equal(createEventMock.mock.calls[0].arguments[1].newStatus, 'Suspended');
    assert.equal(result.lifecycleStatus, 'Suspended');
  });
});

test('requestLifecycleStatusChange / approve / reject (high-severity path)', async (t) => {
  await t.test('rejects a low-severity status (must use the direct path instead)', async () => {
    await assert.rejects(
      () => studentService.requestLifecycleStatusChange({}, 's1', { newStatus: 'Suspended', reason: 'x' }, { requestedByUserId: 'u1' }),
      studentService.StudentLifecycleValidationError,
    );
  });

  await t.test('submits a workflow request (Principal approver) and sets pending fields', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 's1', college_id: 'c1', lifecycle_status: 'Active' }));
    const findPrincipalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-1' }));
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-1', ...fields }));
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPrincipalMock.mock.restore();
      submitMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.requestLifecycleStatusChange({}, 's1', { newStatus: 'Dismissed', reason: 'misconduct' }, { requestedByUserId: 'tutor-1' });
    assert.equal(result.workflowRequest.id, 'wf-1');
    assert.equal(updateMock.mock.calls[0].arguments[2].pendingLifecycleStatus, 'Dismissed');
  });

  function mockPending(t, student) {
    const findMock = t.mock.method(studentRepository, 'findById', async () => student);
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    return { findMock, findPendingMock };
  }

  await t.test('approving a Dismissed request writes one lifecycle event and sets the final status', async () => {
    const { findMock, findPendingMock } = mockPending(t, {
      id: 's1', college_id: 'c1', lifecycle_status: 'Active', pending_lifecycle_status: 'Dismissed', pending_lifecycle_reason: 'misconduct',
    });
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({}));
    const createEventMock = t.mock.method(studentLifecycleEventRepository, 'create', async (client, fields) => fields);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      createEventMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.approveLifecycleStatusChange({}, 's1', { actorUserId: 'principal-1' });
    assert.equal(createEventMock.mock.callCount(), 1);
    assert.equal(result.lifecycleStatus, 'Dismissed');
    assert.equal(result.pendingLifecycleStatus, null);
  });

  await t.test('approving a Graduated request cascades to Alumni with two lifecycle events', async () => {
    const { findMock, findPendingMock } = mockPending(t, {
      id: 's1', college_id: 'c1', lifecycle_status: 'Active', pending_lifecycle_status: 'Graduated', pending_lifecycle_reason: 'completed programme',
    });
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({}));
    const createEventMock = t.mock.method(studentLifecycleEventRepository, 'create', async (client, fields) => fields);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      createEventMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.approveLifecycleStatusChange({}, 's1', { actorUserId: 'principal-1' });
    assert.equal(createEventMock.mock.callCount(), 2);
    assert.equal(createEventMock.mock.calls[1].arguments[1].newStatus, 'Alumni');
    assert.equal(result.lifecycleStatus, 'Alumni');
  });

  await t.test('rejecting clears pending fields without writing a lifecycle event', async () => {
    const { findMock, findPendingMock } = mockPending(t, {
      id: 's1', college_id: 'c1', lifecycle_status: 'Active', pending_lifecycle_status: 'Dismissed',
    });
    const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({}));
    const createEventMock = t.mock.method(studentLifecycleEventRepository, 'create');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    t.after(() => {
      findMock.mock.restore();
      findPendingMock.mock.restore();
      rejectMock.mock.restore();
      createEventMock.mock.restore();
      auditMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.rejectLifecycleStatusChange({}, 's1', { actorUserId: 'principal-1' });
    assert.equal(createEventMock.mock.callCount(), 0);
    assert.equal(result.pendingLifecycleStatus, null);
  });
});

test('promoteSemesterForClass', async (t) => {
  await t.test('returns empty result for a class with no students', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => []);
    t.after(() => findRosterMock.mock.restore());
    const result = await studentService.promoteSemesterForClass({}, 'class-1');
    assert.deepEqual(result, { promoted: [], exceptions: [] });
  });

  await t.test('skips Discontinued/Debarred/Dismissed students, promotes everyone else', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      { id: 's1', college_id: 'c1', lifecycle_status: 'Active', current_semester: 2 },
      { id: 's2', college_id: 'c1', lifecycle_status: 'Discontinued', current_semester: 2 },
      { id: 's3', college_id: 'c1', lifecycle_status: 'Dismissed', current_semester: 3 },
    ]);
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findRosterMock.mock.restore();
      getConfigMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.promoteSemesterForClass({}, 'class-1', { actorUserId: 'principal-1' });
    assert.equal(result.promoted.length, 1);
    assert.equal(result.promoted[0].currentSemester, 3);
    assert.equal(result.exceptions.length, 2);
  });

  await t.test('Suspended students are blocked by default (no institution config)', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      { id: 's1', college_id: 'c1', lifecycle_status: 'Suspended', current_semester: 1 },
    ]);
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const updateMock = t.mock.method(studentRepository, 'update');
    t.after(() => {
      findRosterMock.mock.restore();
      getConfigMock.mock.restore();
      updateMock.mock.restore();
    });

    const result = await studentService.promoteSemesterForClass({}, 'class-1');
    assert.equal(result.exceptions.length, 1);
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('Suspended students are promoted when the institution opts in', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      { id: 's1', college_id: 'c1', lifecycle_status: 'Suspended', current_semester: 1 },
    ]);
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({ configuration: { promoteSuspendedStudents: true } }));
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findRosterMock.mock.restore();
      getConfigMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.promoteSemesterForClass({}, 'class-1');
    assert.equal(result.promoted.length, 1);
    assert.equal(result.exceptions.length, 0);
  });

  await t.test('a student with no current_semester on file starts at 1', async () => {
    const findRosterMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      { id: 's1', college_id: 'c1', lifecycle_status: 'Active', current_semester: null },
    ]);
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findRosterMock.mock.restore();
      getConfigMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.promoteSemesterForClass({}, 'class-1');
    assert.equal(result.promoted[0].currentSemester, 1);
  });
});
