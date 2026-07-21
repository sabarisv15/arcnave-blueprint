'use strict';

// Unit tests for academicService.sendClassAlert — item 5 of this
// session's task (tutor -> own class WhatsApp alert, not routed
// through WorkflowService). No live Postgres: classRepository/
// studentRepository/notificationService/auditLogRepository mocked via
// node:test's built-in mock, same technique academic-service.test.js
// already uses for this file's other functions. The tutor gate itself
// moved off classes.tutor_user_id onto
// identityService.resolvePositionOccupant's {classId} overload in
// Phase 2 step 13 — mocked here rather than the class row carrying
// tutor_user_id.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const studentRepository = require('../src/repositories/studentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const notificationService = require('../src/services/notificationService');
const identityService = require('../src/services/identityService');
const academicService = require('../src/services/academicService');

test('academicService.sendClassAlert', async (t) => {
  await t.test('rejects an empty body without touching the repository', async () => {
    const findMock = t.mock.method(classRepository, 'findById');
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => academicService.sendClassAlert({}, 'class-1', '', { actorUserId: 'tutor-1' }),
      academicService.ClassSendAlertValidationError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('throws ClassSendAlertValidationError for a nonexistent class', async () => {
    const findMock = t.mock.method(classRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => academicService.sendClassAlert({}, 'missing-class', 'hello', { actorUserId: 'tutor-1' }),
      academicService.ClassSendAlertValidationError,
    );
  });

  await t.test('throws ClassSendAlertNotTutorError when the actor is not this class\'s tutor', async () => {
    const findMock = t.mock.method(classRepository, 'findById', async () => ({
      id: 'class-1', college_id: 'c1',
    }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'real-tutor');
    t.after(() => {
      findMock.mock.restore();
      resolveTutorMock.mock.restore();
    });

    await assert.rejects(
      () => academicService.sendClassAlert({}, 'class-1', 'hello', { actorUserId: 'someone-else' }),
      academicService.ClassSendAlertNotTutorError,
    );
  });

  await t.test('sends to each student\'s verified phone and verified parent_phone, skips unverified numbers, and audit-logs a summary', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({
      id: 'class-1', college_id: 'c1',
    }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const findStudentsMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      {
        id: 'student-1', phone: '+15551111111', phone_verified: true, parent_phone: '+15552222222', parent_phone_verified: true,
      },
      {
        id: 'student-2', phone: '+15553333333', phone_verified: false, parent_phone: '+15554444444', parent_phone_verified: true,
      },
      {
        id: 'student-3', phone: '+15555555555', phone_verified: true, parent_phone: null, parent_phone_verified: false,
      },
    ]);
    const sendMock = t.mock.method(notificationService, 'sendViaChannel', async (client, args) => ({
      channel: args.channel, status: args.to === '+15552222222' ? 'failed' : 'sent', to: args.to, error: args.to === '+15552222222' ? 'not opted in' : undefined,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      findStudentsMock.mock.restore();
      sendMock.mock.restore();
      auditMock.mock.restore();
    });

    const results = await academicService.sendClassAlert({}, 'class-1', 'Tomorrow is a holiday', { actorUserId: 'tutor-1' });

    // student-1: phone + parent_phone (2), student-2: parent_phone only (1), student-3: phone only (1) = 4
    assert.equal(results.length, 4);
    assert.equal(sendMock.mock.callCount(), 4);
    assert.ok(sendMock.mock.calls.every((call) => call.arguments[1].channel === 'whatsapp'));
    assert.ok(!results.some((r) => r.phone === '+15553333333')); // student-2's own unverified phone never sent
    assert.ok(!results.some((r) => r.phone === null));

    const failedResult = results.find((r) => r.phone === '+15552222222');
    assert.equal(failedResult.status, 'failed');
    assert.equal(failedResult.error, 'not opted in');

    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'class_alert_sent');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.recipientCount, 4);
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.sentCount, 3);
  });

  await t.test('returns an empty result list (still audit-logged) when no student in the class has any verified number', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({
      id: 'class-1', college_id: 'c1',
    }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const findStudentsMock = t.mock.method(studentRepository, 'findByClassId', async () => [
      {
        id: 'student-1', phone: '+15551111111', phone_verified: false, parent_phone: null, parent_phone_verified: false,
      },
    ]);
    const sendMock = t.mock.method(notificationService, 'sendViaChannel', async () => { throw new Error('must not be called'); });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      findStudentsMock.mock.restore();
      sendMock.mock.restore();
      auditMock.mock.restore();
    });

    const results = await academicService.sendClassAlert({}, 'class-1', 'hello', { actorUserId: 'tutor-1' });

    assert.deepEqual(results, []);
    assert.equal(sendMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.recipientCount, 0);
  });
});
