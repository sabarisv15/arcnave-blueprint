'use strict';

// Unit tests for WorkflowChainService.resolveApproverChain and the
// delegation functions — no live Postgres needed: configurationService/
// staffService/classRepository/workflowDelegationRepository/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const configurationService = require('../src/services/configurationService');
const staffService = require('../src/services/staffService');
const classRepository = require('../src/repositories/classRepository');
const workflowDelegationRepository = require('../src/repositories/workflowDelegationRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const workflowChainService = require('../src/services/workflowChainService');

test('resolveApproverChain', async (t) => {
  await t.test('rejects missing collegeId/entityType', async () => {
    await assert.rejects(
      () => workflowChainService.resolveApproverChain({}, {}),
      workflowChainService.WorkflowChainValidationError,
    );
  });

  await t.test('throws for an unknown entityType with no config and no default', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    t.after(() => getConfigMock.mock.restore());
    await assert.rejects(
      () => workflowChainService.resolveApproverChain({}, { collegeId: 'c1', entityType: 'made_up_module' }),
      workflowChainService.WorkflowChainUnknownEntityTypeError,
    );
  });

  await t.test('falls back to DEFAULT_CHAINS when the institution has not configured anything', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const findPrincipalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-1' }));
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findPrincipalMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain({}, { collegeId: 'c1', entityType: 'fee_structure' });
    assert.deepEqual(chain, [{ step: 1, role: 'principal', user_id: 'principal-1' }]);
  });

  await t.test('uses the institution-configured chain instead of the default when one exists', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
      configuration: { fee_structure: ['hod', 'principal'] },
    }));
    const findHodMock = t.mock.method(staffService, 'findHodForDepartment', async () => ({ user_id: 'hod-1' }));
    const findPrincipalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-1' }));
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findHodMock.mock.restore();
      findPrincipalMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain({}, {
      collegeId: 'c1', entityType: 'fee_structure', departmentId: 'dept-1',
    });
    assert.deepEqual(chain, [
      { step: 1, role: 'hod', user_id: 'hod-1' },
      { step: 2, role: 'principal', user_id: 'principal-1' },
    ]);
  });

  await t.test('resolves "tutor" from the class\'s own tutor_user_id', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', tutor_user_id: 'tutor-1' }));
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findClassMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain({}, {
      collegeId: 'c1', entityType: 'attendance_correction', classId: 'class-1',
    });
    assert.deepEqual(chain, [{ step: 1, role: 'tutor', user_id: 'tutor-1' }]);
  });

  await t.test('throws WorkflowChainMissingContextError for "hod" with no departmentId', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    t.after(() => getConfigMock.mock.restore());
    await assert.rejects(
      () => workflowChainService.resolveApproverChain({}, { collegeId: 'c1', entityType: 'timetable_approval' }),
      workflowChainService.WorkflowChainMissingContextError,
    );
  });

  await t.test('substitutes an active delegation for the resolved principal', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const findPrincipalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-1' }));
    const findDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => ({ delegate_user_id: 'delegate-1' }));
    t.after(() => {
      getConfigMock.mock.restore();
      findPrincipalMock.mock.restore();
      findDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain({}, { collegeId: 'c1', entityType: 'fee_structure' });
    assert.equal(chain[0].user_id, 'delegate-1');
  });
});

test('createDelegation / revokeDelegation', async (t) => {
  await t.test('rejects an unknown role', async () => {
    await assert.rejects(
      () => workflowChainService.createDelegation({}, { role: 'super_admin', delegateUserId: 'u1', startDate: '2026-01-01' }),
      workflowChainService.WorkflowChainUnknownRoleError,
    );
  });

  await t.test('rejects missing delegateUserId/startDate', async () => {
    await assert.rejects(
      () => workflowChainService.createDelegation({}, { role: 'principal' }),
      workflowChainService.WorkflowChainValidationError,
    );
  });

  await t.test('creates and audit-logs a delegation', async () => {
    const createMock = t.mock.method(workflowDelegationRepository, 'create', async (client, fields) => ({ id: 'del-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await workflowChainService.createDelegation({}, {
      role: 'principal', delegateUserId: 'delegate-1', startDate: '2026-01-01',
    }, { actorUserId: 'principal-1', collegeId: 'c1' });
    assert.equal(result.id, 'del-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'workflow_delegation_created');
  });

  await t.test('revokeDelegation returns null for a nonexistent/already-revoked delegation', async () => {
    const revokeMock = t.mock.method(workflowDelegationRepository, 'revoke', async () => null);
    t.after(() => revokeMock.mock.restore());
    const result = await workflowChainService.revokeDelegation({}, 'missing');
    assert.equal(result, null);
  });
});
