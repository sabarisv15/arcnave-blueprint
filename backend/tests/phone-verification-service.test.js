'use strict';

// Unit tests for phoneVerificationService — item 1 of this session's
// task (WhatsApp OTP for student/parent phone verification). No live
// Postgres/WhatsApp here: studentRepository/studentPhoneOtpRepository/
// notificationService/auditLogRepository mocked via node:test's
// built-in mock, same technique notification-service.test.js already
// uses for its own repository dependencies.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const studentRepository = require('../src/repositories/studentRepository');
const studentPhoneOtpRepository = require('../src/repositories/studentPhoneOtpRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const notificationService = require('../src/services/notificationService');
const phoneVerificationService = require('../src/services/phoneVerificationService');

function hashOf(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

test('phoneVerificationService.requestOtp', async (t) => {
  await t.test('rejects an unknown target without touching the repository', async () => {
    const findMock = t.mock.method(studentRepository, 'findById');
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => phoneVerificationService.requestOtp({}, 'student-1', 'email'),
      phoneVerificationService.PhoneVerificationValidationError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('throws PhoneVerificationStudentNotFoundError for a nonexistent student', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => phoneVerificationService.requestOtp({}, 'missing-id', 'phone'),
      phoneVerificationService.PhoneVerificationStudentNotFoundError,
    );
  });

  await t.test('throws PhoneVerificationNoPhoneOnFileError when the target column is empty', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 'student-1', college_id: 'c1', phone: null }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => phoneVerificationService.requestOtp({}, 'student-1', 'phone'),
      phoneVerificationService.PhoneVerificationNoPhoneOnFileError,
    );
  });

  await t.test('creates an OTP row, sends via whatsapp (never sms/email), and audit-logs', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({
      id: 'student-1', college_id: 'c1', phone: '+15551234567',
    }));
    const createMock = t.mock.method(studentPhoneOtpRepository, 'create', async (client, fields) => ({ id: 'otp-1', ...fields }));
    const sendMock = t.mock.method(notificationService, 'sendViaChannel', async (client, args) => ({ channel: args.channel, status: 'sent', to: args.to }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
      sendMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await phoneVerificationService.requestOtp({}, 'student-1', 'phone', { actorUserId: 'user-1' });

    assert.equal(result.deliveryStatus, 'sent');
    assert.ok(result.expiresAt instanceof Date);
    assert.equal(createMock.mock.calls[0].arguments[1].target, 'phone');
    assert.equal(createMock.mock.calls[0].arguments[1].phone, '+15551234567');
    assert.match(createMock.mock.calls[0].arguments[1].codeHash, /^[a-f0-9]{64}$/);
    assert.equal(sendMock.mock.calls[0].arguments[1].channel, 'whatsapp');
    assert.equal(sendMock.mock.calls[0].arguments[1].to, '+15551234567');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_phone_otp_requested');
  });

  await t.test('targets parent_phone when requested, not the student\'s own phone', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => ({
      id: 'student-1', college_id: 'c1', phone: '+15551234567', parent_phone: '+15557654321',
    }));
    const createMock = t.mock.method(studentPhoneOtpRepository, 'create', async (client, fields) => ({ id: 'otp-1', ...fields }));
    const sendMock = t.mock.method(notificationService, 'sendViaChannel', async (client, args) => ({ channel: args.channel, status: 'sent', to: args.to }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
      sendMock.mock.restore();
      auditMock.mock.restore();
    });

    await phoneVerificationService.requestOtp({}, 'student-1', 'parent_phone', { actorUserId: 'user-1' });

    assert.equal(sendMock.mock.calls[0].arguments[1].to, '+15557654321');
  });
});

test('phoneVerificationService.verifyOtp', async (t) => {
  await t.test('rejects a missing code without touching the repository', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 'student-1', college_id: 'c1' }));
    const findOtpMock = t.mock.method(studentPhoneOtpRepository, 'findLatestActive');
    t.after(() => {
      findStudentMock.mock.restore();
      findOtpMock.mock.restore();
    });

    await assert.rejects(
      () => phoneVerificationService.verifyOtp({}, 'student-1', 'phone', ''),
      phoneVerificationService.PhoneVerificationValidationError,
    );
    assert.equal(findOtpMock.mock.callCount(), 0);
  });

  await t.test('throws PhoneVerificationNotRequestedError when no live OTP exists', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 'student-1', college_id: 'c1' }));
    const findOtpMock = t.mock.method(studentPhoneOtpRepository, 'findLatestActive', async () => null);
    t.after(() => {
      findStudentMock.mock.restore();
      findOtpMock.mock.restore();
    });

    await assert.rejects(
      () => phoneVerificationService.verifyOtp({}, 'student-1', 'phone', '123456'),
      phoneVerificationService.PhoneVerificationNotRequestedError,
    );
  });

  await t.test('throws PhoneVerificationMaxAttemptsExceededError when attempts is already at the cap', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 'student-1', college_id: 'c1' }));
    const findOtpMock = t.mock.method(studentPhoneOtpRepository, 'findLatestActive', async () => ({
      id: 'otp-1', code_hash: hashOf('123456'), attempts: 5,
    }));
    t.after(() => {
      findStudentMock.mock.restore();
      findOtpMock.mock.restore();
    });

    await assert.rejects(
      () => phoneVerificationService.verifyOtp({}, 'student-1', 'phone', '123456'),
      phoneVerificationService.PhoneVerificationMaxAttemptsExceededError,
    );
  });

  await t.test('increments attempts and throws PhoneVerificationCodeMismatchError on a wrong code', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 'student-1', college_id: 'c1' }));
    const findOtpMock = t.mock.method(studentPhoneOtpRepository, 'findLatestActive', async () => ({
      id: 'otp-1', code_hash: hashOf('123456'), attempts: 0,
    }));
    const incrementMock = t.mock.method(studentPhoneOtpRepository, 'incrementAttempts', async () => {});
    t.after(() => {
      findStudentMock.mock.restore();
      findOtpMock.mock.restore();
      incrementMock.mock.restore();
    });

    await assert.rejects(
      () => phoneVerificationService.verifyOtp({}, 'student-1', 'phone', '000000'),
      phoneVerificationService.PhoneVerificationCodeMismatchError,
    );
    assert.equal(incrementMock.mock.calls[0].arguments[1], 'otp-1');
  });

  await t.test('marks the OTP consumed and sets phone_verified on a correct code for target=phone', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 'student-1', college_id: 'c1' }));
    const findOtpMock = t.mock.method(studentPhoneOtpRepository, 'findLatestActive', async () => ({
      id: 'otp-1', code_hash: hashOf('123456'), attempts: 0,
    }));
    const consumeMock = t.mock.method(studentPhoneOtpRepository, 'markConsumed', async () => {});
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findStudentMock.mock.restore();
      findOtpMock.mock.restore();
      consumeMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const student = await phoneVerificationService.verifyOtp({}, 'student-1', 'phone', '123456', { actorUserId: 'user-1' });

    assert.equal(consumeMock.mock.calls[0].arguments[1], 'otp-1');
    assert.deepEqual(updateMock.mock.calls[0].arguments[2], { phoneVerified: true });
    assert.equal(student.phoneVerified, true);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_phone_otp_verified');
  });

  await t.test('sets parent_phone_verified for target=parent_phone', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 'student-1', college_id: 'c1' }));
    const findOtpMock = t.mock.method(studentPhoneOtpRepository, 'findLatestActive', async () => ({
      id: 'otp-1', code_hash: hashOf('654321'), attempts: 0,
    }));
    const consumeMock = t.mock.method(studentPhoneOtpRepository, 'markConsumed', async () => {});
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findStudentMock.mock.restore();
      findOtpMock.mock.restore();
      consumeMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await phoneVerificationService.verifyOtp({}, 'student-1', 'parent_phone', '654321');

    assert.deepEqual(updateMock.mock.calls[0].arguments[2], { parentPhoneVerified: true });
  });
});
