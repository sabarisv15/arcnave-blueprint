'use strict';

// Unit tests for StudentService's pure business-logic paths — these
// need no live Postgres at all: studentRepository and
// auditLogRepository are stubbed via node:test's built-in mock (works
// here because studentService always calls e.g.
// `studentRepository.create(...)` as a fresh property lookup on the
// shared module object, never a destructured local reference, so
// replacing the export before the call takes effect).
//
// What's deliberately NOT here: an actual (college_id, roll_no)
// unique-violation reaching StudentRollNoConflictError end-to-end.
// That needs a real Postgres 23505 from the live constraint, not a
// hand-thrown err.code — verified manually against a throwaway
// postgres:16 container the same way the migration itself was, not as
// a committed test (no studentRepository tests exist yet either).

const test = require('node:test');
const assert = require('node:assert/strict');
const studentRepository = require('../src/repositories/studentRepository');
const classRepository = require('../src/repositories/classRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const studentService = require('../src/services/studentService');

// createStudent now always resolves the actor's own class via
// classRepository.findByTutorUserId before touching studentRepository
// at all (student creation is tutor-only, own-class-only — this
// session's own task) — every createStudent test below mocks that
// lookup, defaulting to "actor tutors class-1" unless a test is
// specifically exercising the not-a-tutor/mismatch paths.
function mockTutorClass(t, classRow = { id: 'class-1', college_id: 'c1', tutor_user_id: 'u1' }) {
  const findClassMock = t.mock.method(classRepository, 'findByTutorUserId', async () => classRow);
  t.after(() => findClassMock.mock.restore());
  return findClassMock;
}

test('StudentService validation and audit logging (no DB)', async (t) => {
  await t.test('createStudent rejects a missing rollNo without touching the DB', async () => {
    const createMock = t.mock.method(studentRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.createStudent({}, { collegeId: 'c1', fullName: 'Alice', userId: 'u1' }),
      studentService.StudentValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStudent rejects a missing fullName without touching the DB', async () => {
    const createMock = t.mock.method(studentRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.createStudent({}, { collegeId: 'c1', rollNo: 'R1', userId: 'u1' }),
      studentService.StudentValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStudent throws StudentNotClassTutorError when the actor is not any class\'s tutor, without touching studentRepository', async () => {
    mockTutorClass(t, null);
    const createMock = t.mock.method(studentRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.createStudent({}, {
        collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1',
      }),
      studentService.StudentNotClassTutorError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStudent throws StudentClassMismatchError when the caller asserts a classId that is not the actor\'s own', async () => {
    mockTutorClass(t, { id: 'class-1', college_id: 'c1', tutor_user_id: 'u1' });
    const createMock = t.mock.method(studentRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.createStudent({}, {
        collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1', classId: 'someone-elses-class',
      }),
      studentService.StudentClassMismatchError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStudent auto-sets class_id from the actor\'s resolved class, ignoring/validating any asserted classId', async () => {
    mockTutorClass(t, { id: 'class-1', college_id: 'c1', tutor_user_id: 'u1' });
    const createMock = t.mock.method(studentRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
      class_id: fields.classId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const student = await studentService.createStudent({}, {
      collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1', classId: 'class-1',
    });

    assert.equal(createMock.mock.calls[0].arguments[1].classId, 'class-1');
    assert.equal(student.class_id, 'class-1');
  });

  await t.test('createStudent drops an aadhaar-shaped field instead of passing it through', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.createStudent({}, {
      collegeId: 'c1',
      rollNo: 'R1',
      fullName: 'Alice',
      userId: 'u1',
      aadhaarNumber: '1234-5678-9012',
    });

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal('aadhaarNumber' in passedFields, false);
  });

  // This session's own task: optional annual income, used for
  // scholarship eligibility (financeService.checkScholarshipEligibility).
  await t.test('createStudent passes annualIncome through to the repository', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.createStudent({}, {
      collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1', annualIncome: 45000,
    });

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal(passedFields.annualIncome, 45000);
  });

  await t.test('createStudent maps a 23505 unique violation to StudentRollNoConflictError', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "students_college_id_roll_no_key"');
      err.code = '23505';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.createStudent({}, { collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1' }),
      studentService.StudentRollNoConflictError,
    );
  });

  await t.test('createStudent maps a students_class_id_fkey violation to StudentClassNotFoundError', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async () => {
      const err = new Error('insert or update on table "students" violates foreign key constraint "students_class_id_fkey"');
      err.code = '23503';
      err.constraint = 'students_class_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.createStudent({}, { collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1' }),
      studentService.StudentClassNotFoundError,
    );
  });

  await t.test('createStudent lets a non-23505/23503 repository error pass through unchanged', async () => {
    mockTutorClass(t);
    const boom = new Error('connection lost');
    const createMock = t.mock.method(studentRepository, 'create', async () => {
      throw boom;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.createStudent({}, { collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1' }),
      (err) => err === boom,
    );
  });

  await t.test('updateStudent with no recognized fields does not write an audit entry', async () => {
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.updateStudent({}, 'student-id', { aadhaarNumber: 'x' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateStudent with a recognized field writes an audit entry', async () => {
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.updateStudent({}, 'student-id', { fullName: 'New Name' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_updated');
  });

  await t.test('updateStudent against a nonexistent id does not write an audit entry', async () => {
    const updateMock = t.mock.method(studentRepository, 'update', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.updateStudent({}, 'missing-id', { fullName: 'New Name' }, { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeStudent on a nonexistent id is a no-op, no audit entry', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => null);
    const removeMock = t.mock.method(studentRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.removeStudent({}, 'missing-id', { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeStudent on an existing id deletes and writes an audit entry', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async (client, id) => ({ id, college_id: 'c1' }));
    const removeMock = t.mock.method(studentRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.removeStudent({}, 'student-id', { userId: 'u1' });

    assert.deepEqual(result, { id: 'student-id', college_id: 'c1' });
    assert.equal(removeMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_removed');
  });
});
