'use strict';

// Unit tests for AssessmentService — no live Postgres needed:
// assessmentTypeRepository/assessmentMarkRepository/
// facultyAllocationRepository/classRepository/auditLogRepository are
// stubbed via node:test's built-in mock, same technique as every other
// *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const assessmentTypeRepository = require('../src/repositories/assessmentTypeRepository');
const assessmentMarkRepository = require('../src/repositories/assessmentMarkRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const classRepository = require('../src/repositories/classRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const assessmentService = require('../src/services/assessmentService');

test('createAssessmentType', async (t) => {
  await t.test('rejects missing collegeId/name', async () => {
    await assert.rejects(
      () => assessmentService.createAssessmentType({}, {}),
      assessmentService.AssessmentTypeValidationError,
    );
  });

  await t.test('maps a duplicate name constraint violation', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'assessment_types_college_name_key' });
    const createMock = t.mock.method(assessmentTypeRepository, 'create', async () => { throw err; });
    t.after(() => createMock.mock.restore());
    await assert.rejects(
      () => assessmentService.createAssessmentType({}, { collegeId: 'c1', name: 'Internal Test 1' }),
      assessmentService.AssessmentTypeNameConflictError,
    );
  });

  await t.test('creates and audit-logs a new assessment type', async () => {
    const createMock = t.mock.method(assessmentTypeRepository, 'create', async (client, fields) => ({ id: 'type-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await assessmentService.createAssessmentType({}, { collegeId: 'c1', name: 'Internal Test 1', maxMarks: 50 }, { actorUserId: 'principal-1' });
    assert.equal(result.id, 'type-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'assessment_type_created');
  });
});

test('recordMark', async (t) => {
  await t.test('rejects missing required fields', async () => {
    await assert.rejects(
      () => assessmentService.recordMark({}, { classId: 'class-1' }),
      assessmentService.AssessmentMarkValidationError,
    );
  });

  await t.test('rejects an unknown class', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => null);
    t.after(() => findClassMock.mock.restore());
    await assert.rejects(
      () => assessmentService.recordMark({}, {
        academicYear: '2026-2027', classId: 'missing', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 40,
      }),
      assessmentService.AssessmentMarkClassNotFoundError,
    );
  });

  await t.test('rejects a faculty member not allocated to this class+subject', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'someone-else' },
    ]);
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
    });
    await assert.rejects(
      () => assessmentService.recordMark({}, {
        academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 40,
      }, { actorUserId: 'faculty-1' }),
      assessmentService.AssessmentMarkNotAssignedFacultyError,
    );
  });

  await t.test('creates a new mark when none exists yet, for the assigned faculty', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findOneMock = t.mock.method(assessmentMarkRepository, 'findOne', async () => null);
    const createMock = t.mock.method(assessmentMarkRepository, 'create', async (client, fields) => ({ id: 'mark-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
      findOneMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await assessmentService.recordMark({}, {
      academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 42,
    }, { actorUserId: 'faculty-1' });
    assert.equal(result.id, 'mark-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'assessment_mark_recorded');
  });

  await t.test('updates an existing mark instead of creating a second row', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findOneMock = t.mock.method(assessmentMarkRepository, 'findOne', async () => ({ id: 'mark-1' }));
    const updateMock = t.mock.method(assessmentMarkRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const createMock = t.mock.method(assessmentMarkRepository, 'create');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
      findOneMock.mock.restore();
      updateMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await assessmentService.recordMark({}, {
      academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 45,
    }, { actorUserId: 'faculty-1' });
    assert.equal(result.marksObtained, 45);
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'assessment_mark_updated');
  });
});

test('listMarksForFilters', async (t) => {
  await t.test('passes classId/subject/assessmentTypeId straight through with no departmentId', async () => {
    const findFiltersMock = t.mock.method(assessmentMarkRepository, 'findByFilters', async () => [{ id: 'mark-1' }]);
    t.after(() => findFiltersMock.mock.restore());
    const result = await assessmentService.listMarksForFilters({}, { classId: 'class-1', subject: 'DBMS' });
    assert.equal(result.length, 1);
    assert.equal(findFiltersMock.mock.calls[0].arguments[1].classIds, undefined);
  });

  await t.test('resolves departmentId to classIds first', async () => {
    const findDeptMock = t.mock.method(classRepository, 'findByDepartmentId', async () => [{ id: 'class-1' }, { id: 'class-2' }]);
    const findFiltersMock = t.mock.method(assessmentMarkRepository, 'findByFilters', async () => []);
    t.after(() => {
      findDeptMock.mock.restore();
      findFiltersMock.mock.restore();
    });
    await assessmentService.listMarksForFilters({}, { departmentId: 'dept-1' });
    assert.deepEqual(findFiltersMock.mock.calls[0].arguments[1].classIds, ['class-1', 'class-2']);
  });

  await t.test('returns an empty list without querying marks when the department has no classes', async () => {
    const findDeptMock = t.mock.method(classRepository, 'findByDepartmentId', async () => []);
    const findFiltersMock = t.mock.method(assessmentMarkRepository, 'findByFilters');
    t.after(() => {
      findDeptMock.mock.restore();
      findFiltersMock.mock.restore();
    });
    const result = await assessmentService.listMarksForFilters({}, { departmentId: 'empty-dept' });
    assert.deepEqual(result, []);
    assert.equal(findFiltersMock.mock.callCount(), 0);
  });
});
