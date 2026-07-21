'use strict';

// Unit tests for academicService.assignSubstitute/getSubstituteAssignment
// and the substitute leg of attendanceService.assertCanMark — no live
// Postgres needed: classRepository/substituteAssignmentRepository/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite.
// assertCanMark's tutor check moved off classes.tutor_user_id onto
// identityService.resolvePositionOccupant's {classId} overload in
// Phase 2 step 15 — mocked here rather than the class row carrying
// tutor_user_id.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const substituteAssignmentRepository = require('../src/repositories/substituteAssignmentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const academicService = require('../src/services/academicService');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const identityService = require('../src/services/identityService');
const attendanceService = require('../src/services/attendanceService');

test('academicService.assignSubstitute', async (t) => {
  await t.test('rejects missing required fields', async () => {
    await assert.rejects(
      () => academicService.assignSubstitute({}, { classId: 'class-1' }),
      academicService.SubstituteAssignmentValidationError,
    );
  });

  await t.test('rejects an unknown classId', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => null);
    t.after(() => findClassMock.mock.restore());
    await assert.rejects(
      () => academicService.assignSubstitute({}, {
        classId: 'missing', timetablePeriodId: 'p1', assignmentDate: '2026-06-01', substituteStaffUserId: 'u2',
      }),
      academicService.ClassValidationError,
    );
  });

  await t.test('creates an assignment and audit-logs it', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const createMock = t.mock.method(substituteAssignmentRepository, 'create', async (client, fields) => ({ id: 'sub-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.assignSubstitute({}, {
      classId: 'class-1', timetablePeriodId: 'p1', assignmentDate: '2026-06-01', substituteStaffUserId: 'u2', reason: 'sick leave',
    }, { actorUserId: 'hod-1' });
    assert.equal(result.id, 'sub-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'substitute_assigned');
    assert.equal(createMock.mock.calls[0].arguments[1].assigningAuthorityUserId, 'hod-1');
  });

  await t.test('maps a period-not-found constraint violation', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const err = Object.assign(new Error('fk'), { code: '23503', constraint: 'substitute_assignments_timetable_period_id_fkey' });
    const createMock = t.mock.method(substituteAssignmentRepository, 'create', async () => { throw err; });
    t.after(() => {
      findClassMock.mock.restore();
      createMock.mock.restore();
    });
    await assert.rejects(
      () => academicService.assignSubstitute({}, {
        classId: 'class-1', timetablePeriodId: 'missing', assignmentDate: '2026-06-01', substituteStaffUserId: 'u2',
      }),
      academicService.SubstituteAssignmentPeriodNotFoundError,
    );
  });

  await t.test('maps a duplicate (period, date) constraint violation', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'substitute_assignments_class_period_date_key' });
    const createMock = t.mock.method(substituteAssignmentRepository, 'create', async () => { throw err; });
    t.after(() => {
      findClassMock.mock.restore();
      createMock.mock.restore();
    });
    await assert.rejects(
      () => academicService.assignSubstitute({}, {
        classId: 'class-1', timetablePeriodId: 'p1', assignmentDate: '2026-06-01', substituteStaffUserId: 'u2',
      }),
      academicService.SubstituteAssignmentConflictError,
    );
  });
});

test('attendanceService.assertCanMark recognizes an authorized substitute', async (t) => {
  const CLASS_ROW = {
    id: 'class-1', college_id: 'c1', timetable_status: 'Approved',
  };

  await t.test('a substitute assigned for this exact (period, date) may mark attendance', async () => {
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const periodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => ({ id: 'period-1' }));
    const allocationMock = t.mock.method(academicService, 'getFacultyAllocationForClassAndPeriod', async () => null);
    const subMock = t.mock.method(academicService, 'getSubstituteAssignment', async () => ({ substitute_staff_user_id: 'sub-teacher-1' }));
    const findSessionMock = t.mock.method(attendanceRepository, 'findByClassSessionAndHour', async () => null);
    const createMock = t.mock.method(attendanceRepository, 'create', async (client, fields) => ({ id: 'sess-1', ...fields }));
    const auditMock = t.mock.method(require('../src/repositories/auditLogRepository'), 'createAuditLogEntry', async () => {});
    t.after(() => {
      resolveTutorMock.mock.restore();
      periodMock.mock.restore();
      allocationMock.mock.restore();
      subMock.mock.restore();
      findSessionMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const getClassMock = t.mock.method(academicService, 'getClass', async () => CLASS_ROW);
    t.after(() => getClassMock.mock.restore());

    const session = await attendanceService.markAttendance({}, {
      classId: 'class-1', sessionDate: '2026-06-01', hourIndex: 2, absentStudentIds: [], totalStudents: 40,
    }, { actorUserId: 'sub-teacher-1', actorRole: 'staff' });
    assert.equal(session.id, 'sess-1');
  });

  await t.test('a different staff member (not tutor/hod/scheduled/substitute) is rejected', async () => {
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const periodMock = t.mock.method(academicService, 'getTimetablePeriodByDayAndHour', async () => ({ id: 'period-1' }));
    const allocationMock = t.mock.method(academicService, 'getFacultyAllocationForClassAndPeriod', async () => null);
    const subMock = t.mock.method(academicService, 'getSubstituteAssignment', async () => ({ substitute_staff_user_id: 'sub-teacher-1' }));
    const getClassMock = t.mock.method(academicService, 'getClass', async () => CLASS_ROW);
    t.after(() => {
      resolveTutorMock.mock.restore();
      periodMock.mock.restore();
      allocationMock.mock.restore();
      subMock.mock.restore();
      getClassMock.mock.restore();
    });

    await assert.rejects(
      () => attendanceService.markAttendance({}, {
        classId: 'class-1', sessionDate: '2026-06-01', hourIndex: 2, absentStudentIds: [], totalStudents: 40,
      }, { actorUserId: 'unrelated-staff', actorRole: 'staff' }),
      attendanceService.AttendanceForbiddenError,
    );
  });
});
