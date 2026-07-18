'use strict';

// Unit tests for FinanceService.recordScholarshipDecision/
// listScholarshipDecisionsForStudent — no live Postgres needed:
// studentService/classRepository/scholarshipDecisionRepository/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as finance-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const studentService = require('../src/services/studentService');
const classRepository = require('../src/repositories/classRepository');
const scholarshipDecisionRepository = require('../src/repositories/scholarshipDecisionRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const financeService = require('../src/services/financeService');

test('recordScholarshipDecision', async (t) => {
  await t.test('rejects missing schemeName', async () => {
    await assert.rejects(
      () => financeService.recordScholarshipDecision({}, 's1', { eligible: true }, { actorUserId: 'tutor-1' }),
      financeService.ScholarshipDecisionValidationError,
    );
  });

  await t.test('rejects a non-boolean eligible', async () => {
    await assert.rejects(
      () => financeService.recordScholarshipDecision({}, 's1', { schemeName: 'Merit', eligible: 'yes' }, { actorUserId: 'tutor-1' }),
      financeService.ScholarshipDecisionValidationError,
    );
  });

  await t.test('rejects an unknown student', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => null);
    t.after(() => getStudentMock.mock.restore());
    await assert.rejects(
      () => financeService.recordScholarshipDecision({}, 'missing', { schemeName: 'Merit', eligible: true }, { actorUserId: 'tutor-1' }),
      financeService.ScholarshipStudentNotFoundError,
    );
  });

  await t.test('rejects an actor who is not the student\'s class tutor', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', college_id: 'c1', class_id: 'class-1' }));
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', tutor_user_id: 'tutor-1' }));
    t.after(() => {
      getStudentMock.mock.restore();
      findClassMock.mock.restore();
    });
    await assert.rejects(
      () => financeService.recordScholarshipDecision({}, 's1', { schemeName: 'Merit', eligible: true }, { actorUserId: 'someone-else' }),
      financeService.ScholarshipDecisionNotTutorError,
    );
  });

  await t.test('records the decision and audit-logs it when the actor is the real class tutor', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', college_id: 'c1', class_id: 'class-1' }));
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', tutor_user_id: 'tutor-1' }));
    const createMock = t.mock.method(scholarshipDecisionRepository, 'create', async (client, fields) => ({ id: 'decision-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      getStudentMock.mock.restore();
      findClassMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.recordScholarshipDecision({}, 's1', {
      schemeName: 'Merit Scholarship', eligible: true, reason: 'top 5% of class',
    }, { actorUserId: 'tutor-1' });

    assert.equal(result.id, 'decision-1');
    assert.equal(createMock.mock.calls[0].arguments[1].eligible, true);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'scholarship_decision_recorded');
  });

  await t.test('rejects when the student has no class assigned', async () => {
    const getStudentMock = t.mock.method(studentService, 'getStudent', async () => ({ id: 's1', college_id: 'c1', class_id: null }));
    t.after(() => getStudentMock.mock.restore());
    await assert.rejects(
      () => financeService.recordScholarshipDecision({}, 's1', { schemeName: 'Merit', eligible: true }, { actorUserId: 'tutor-1' }),
      financeService.ScholarshipDecisionNotTutorError,
    );
  });
});

test('listScholarshipDecisionsForStudent delegates to the repository listing', async (t) => {
  const listMock = t.mock.method(scholarshipDecisionRepository, 'listForStudent', async () => [{ id: 'd1' }, { id: 'd2' }]);
  t.after(() => listMock.mock.restore());
  const result = await financeService.listScholarshipDecisionsForStudent({}, 's1');
  assert.equal(result.length, 2);
});
