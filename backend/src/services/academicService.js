'use strict';

// Business logic for Module 3's `classes` table — validation and
// audit logging on top of classRepository.js, which does neither
// (CLAUDE.md rule 1: AI tools call Business Services, never
// repositories directly — this file is what makes that possible for
// classes).
//
// This slice is plain CRUD + validation, same shape as
// staffService.js's second slice: no HOD/Principal review-chain
// transition logic ('Pending HOD' -> 'Approved'/'Pending
// Principal'/'Rejected', per HodDashboard.jsx/PrincipalDashboard.jsx's
// handleTimetableReview) is enforced here beyond validating that a
// given timetableStatus is one of the known literals. CLAUDE.md rule
// 3: WorkflowService is the sole approval gate, and it doesn't exist
// yet (Roadmap.md builds Workflow/Notifications after Attendance/
// Finance/Documents/Reports) — same "out of scope here, not stubbed"
// reasoning studentService.js used for the HOD-override exception.
// "Class Tutor is assigned only by HOD" (BusinessRules.md Staff) is an
// authorization rule, left to the route/RBAC layer once Module 3's API
// exists, matching staffService.js's precedent for "only HOD/Principal
// may add staff."
//
// Faculty allocation (assignFacultyAllocation and friends) lives in
// this same file, not a new service: Architecture.md 2.5's own
// Business Services table lists "faculty allocation" as part of what
// AcademicService owns, alongside "timetable" — not inferred, stated
// outright. facultyAllocationRepository.js/timetablePeriodRepository.js
// were added purely additively (classes.timetable_data untouched — see
// that slice's .ai/TASK.md) specifically to give AttendanceService's
// "scheduled staff member" gap (attendanceService.js, 82f8479) a real,
// structured link — surfacing the migration's own uniqueness rules as
// domain errors, same pattern as classRepository's own constraints
// above. No authorization check on assign/remove: BusinessRules.md
// names no specific actor for "who may assign faculty," unlike "Class
// Tutor is assigned only by HOD" — left to the route/RBAC layer once
// an API exists, not invented here.
//
// getTimetablePeriod/getFacultyAllocationForClassAndPeriod are the two
// read-only lookups attendanceService.markAttendance now composes
// (client, day-of-week, hour_index) -> a shared period ->
// (class, period) -> who's allocated to teach it — to verify
// BusinessRules.md Attendance's third eligible marker, "the staff
// member scheduled for that period." See attendanceService.js for the
// composition; this file only exposes the two lookups it's made of.

const classRepository = require('../repositories/classRepository');
const facultyAllocationRepository = require('../repositories/facultyAllocationRepository');
const timetablePeriodRepository = require('../repositories/timetablePeriodRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

// Missing className — classes.class_name is NOT NULL at the DB level.
// Raised before any repository call, same as staffService's pre-query
// guard.
class ClassValidationError extends Error {}

// The Module 3 migration's own comment names this exact gap:
// timetable_status has no DB-level CHECK constraint, "known real
// values, enforced at the service layer once AcademicService exists,
// not the DB" — this is that enforcement. The literal set matches what
// HodDashboard.jsx/PrincipalDashboard.jsx/TutorClass.jsx actually use,
// not a guess.
class ClassTimetableStatusError extends Error {}

// UNIQUE (college_id, class_name) violated (Postgres 23505,
// classes_college_id_class_name_key) — this class name is already
// taken in this college. Never let the raw pg error reach the caller,
// same discipline as StaffCodeConflictError.
class ClassNameConflictError extends Error {}

// UNIQUE (tutor_user_id) violated (Postgres 23505,
// classes_tutor_user_id_key) — this user is already the tutor of
// another class. BusinessRules.md Staff: "Class Tutor is assigned only
// by HOD, for one class at a time" — this is that rule's DB-level
// enforcement surfacing as a domain error instead of a raw pg one.
class ClassTutorConflictError extends Error {}

// classes_tutor_user_id_fkey (classes.tutor_user_id -> users.id)
// violated (Postgres 23503) — the given tutorUserId doesn't exist in
// users. Follows StaffUserNotFoundError's precedent: tutor_user_id is
// the only FK a caller could violate via createClass/updateClass's
// inputs (college_id comes from the tenant-scoped request context, not
// caller-supplied free text), so any 23503 here unambiguously means
// this.
class ClassTutorNotFoundError extends Error {}

// Missing classId, periodId, subject, or staffUserId —
// faculty_allocation.class_id/period_id/subject are NOT NULL at the
// DB level; staffUserId is nullable at the DB level (a non-teaching
// slot like "Lunch"/"Library" can have a subject with no staff), but
// this function is specifically "assign *a staff member's*
// allocation" (per this slice's own task) — recording a non-teaching
// slot with no staff is a different, unaddressed operation, not built
// here, so staffUserId is required at this layer even though the DB
// itself would accept NULL.
class FacultyAllocationValidationError extends Error {}

// faculty_allocation_class_id_fkey violated (Postgres 23503) — the
// given classId doesn't exist. Same precedent as ClassTutorNotFoundError.
class FacultyAllocationClassNotFoundError extends Error {}

// faculty_allocation_period_id_fkey violated (Postgres 23503) — the
// given periodId doesn't exist in timetable_periods.
class FacultyAllocationPeriodNotFoundError extends Error {}

// faculty_allocation_staff_user_id_fkey violated (Postgres 23503) —
// the given staffUserId doesn't exist in users.
class FacultyAllocationStaffNotFoundError extends Error {}

// UNIQUE (class_id, period_id) violated (Postgres 23505,
// faculty_allocation_class_id_period_id_key) — this class already has
// a subject/staff assignment for this period. A class can't have two
// simultaneous subjects in one hour, the same real-world fact the
// free-text timetable grid already enforced implicitly (one cell, one
// value) — see the migration's own .ai/TASK.md.
class FacultyAllocationPeriodTakenError extends Error {}

// UNIQUE (period_id, staff_user_id) violated (Postgres 23505,
// faculty_allocation_period_id_staff_user_id_key) — this staff member
// is already teaching a different class during this exact period. The
// same "one row can't represent two conflicting real-world facts"
// reasoning ClassTutorConflictError already applies to tutor
// assignment, extended here to double-booking a teacher.
class FacultyAllocationStaffConflictError extends Error {}

// Known real timetable_status values, per the migration's own comment
// and .ai/TASK.md's grounding against TutorClass.jsx/
// TutorClassMonitor.jsx.
const VALID_TIMETABLE_STATUSES = [
  'No Tutor',
  'Pending HOD',
  'Pending Principal',
  'Approved',
  'Rejected',
];

// The fields this service accepts for create/update, deliberately
// listed here rather than trusting classRepository's own COLUMNS
// whitelist to be the only line of defense — same defense-in-depth
// reasoning as studentService.js/staffService.js's own ALLOWED_FIELDS.
// collegeId is excluded: a class's tenant is set once at creation and
// never moves via update, same as students/staff.
const ALLOWED_FIELDS = [
  'className',
  'department',
  'semester',
  'tutorUserId',
  'timetableStatus',
  'timetableData',
  'timetableRemarks',
];

function pickClassFields(source) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function assertValidTimetableStatus(timetableStatus) {
  if (timetableStatus !== undefined && !VALID_TIMETABLE_STATUSES.includes(timetableStatus)) {
    throw new ClassTimetableStatusError(
      `timetableStatus ${JSON.stringify(timetableStatus)} is not a known value`,
    );
  }
}

async function createClass(client, { collegeId, className, ...rest }, { actorUserId } = {}) {
  if (!className) {
    throw new ClassValidationError('className is required');
  }
  assertValidTimetableStatus(rest.timetableStatus);

  let cls;
  try {
    cls = await classRepository.create(client, {
      collegeId,
      className,
      ...pickClassFields(rest),
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'classes_college_id_class_name_key') {
      throw new ClassNameConflictError(`className ${JSON.stringify(className)} already exists for this college`);
    }
    if (err.code === '23505' && err.constraint === 'classes_tutor_user_id_key') {
      throw new ClassTutorConflictError(`tutorUserId ${JSON.stringify(rest.tutorUserId)} is already tutoring another class`);
    }
    if (err.code === '23503' && err.constraint === 'classes_tutor_user_id_fkey') {
      throw new ClassTutorNotFoundError(`tutorUserId ${JSON.stringify(rest.tutorUserId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'class_created',
    entity: 'classes',
    entityId: cls.id,
    metadata: null,
  });

  return cls;
}

// null means no class exists with this id — not an error. The route
// turns that into 404, same as staffService.getStaff.
async function getClass(client, id) {
  return classRepository.findById(client, id);
}

async function updateClass(client, id, fields, { userId }) {
  const patch = pickClassFields(fields);
  assertValidTimetableStatus(patch.timetableStatus);
  const hasChanges = Object.keys(patch).length > 0;

  let cls;
  try {
    cls = await classRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'classes_college_id_class_name_key') {
      throw new ClassNameConflictError(`className ${JSON.stringify(patch.className)} already exists for this college`);
    }
    if (err.code === '23505' && err.constraint === 'classes_tutor_user_id_key') {
      throw new ClassTutorConflictError(`tutorUserId ${JSON.stringify(patch.tutorUserId)} is already tutoring another class`);
    }
    if (err.code === '23503' && err.constraint === 'classes_tutor_user_id_fkey') {
      throw new ClassTutorNotFoundError(`tutorUserId ${JSON.stringify(patch.tutorUserId)} does not exist`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // classRepository.update falls back to a plain findById then). cls
  // !== null guards the id-not-found case. Either way, no row was
  // actually changed, so no audit entry.
  if (hasChanges && cls !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: cls.college_id,
      userId,
      action: 'class_updated',
      entity: 'classes',
      entityId: id,
      metadata: null,
    });
  }

  return cls;
}

// Looks the class up first, both to get collegeId for the audit entry
// (removeClass's signature, matching staffService.removeStaff, takes
// no collegeId of its own) and to avoid logging a removal for an id
// that never existed. Still a hard DELETE, not a soft-delete: the ERD
// has no soft-delete column yet — same open question flagged for
// students/staff, not resolved here either.
async function removeClass(client, id, { userId }) {
  const cls = await classRepository.findById(client, id);
  if (cls === null) {
    return null;
  }

  await classRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId,
    action: 'class_removed',
    entity: 'classes',
    entityId: id,
    metadata: null,
  });

  return cls;
}

async function listClasses(client, { limit, offset } = {}) {
  return classRepository.list(client, { limit, offset });
}

// Assigns a staff member to teach a subject during a specific
// (class, period) slot. No update variant is exposed here — this
// slice's own task names exactly "assign/list/remove," not "update";
// changing an existing allocation is remove-then-assign, not an
// in-place edit, even though facultyAllocationRepository.update exists
// and classRepository's own precedent has a full update path. Nothing
// asked for reassignment-in-place, so it isn't built.
async function assignFacultyAllocation(client, { collegeId, classId, periodId, subject, staffUserId }, { actorUserId } = {}) {
  if (!classId || !periodId || !subject || !staffUserId) {
    throw new FacultyAllocationValidationError('classId, periodId, subject, and staffUserId are required');
  }

  let allocation;
  try {
    allocation = await facultyAllocationRepository.create(client, {
      collegeId,
      classId,
      periodId,
      subject,
      staffUserId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'faculty_allocation_class_id_period_id_key') {
      throw new FacultyAllocationPeriodTakenError(
        `class ${JSON.stringify(classId)} already has an allocation for period ${JSON.stringify(periodId)}`,
      );
    }
    if (err.code === '23505' && err.constraint === 'faculty_allocation_period_id_staff_user_id_key') {
      throw new FacultyAllocationStaffConflictError(
        `staffUserId ${JSON.stringify(staffUserId)} is already teaching another class during period ${JSON.stringify(periodId)}`,
      );
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_class_id_fkey') {
      throw new FacultyAllocationClassNotFoundError(`classId ${JSON.stringify(classId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_period_id_fkey') {
      throw new FacultyAllocationPeriodNotFoundError(`periodId ${JSON.stringify(periodId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_staff_user_id_fkey') {
      throw new FacultyAllocationStaffNotFoundError(`staffUserId ${JSON.stringify(staffUserId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'faculty_allocation_assigned',
    entity: 'faculty_allocation',
    entityId: allocation.id,
    metadata: null,
  });

  return allocation;
}

// null means no allocation exists with this id — not an error. The
// route turns that into 404, same as getClass.
async function getFacultyAllocation(client, id) {
  return facultyAllocationRepository.findById(client, id);
}

// A class's full teaching schedule — every period it has a real
// subject/staff assignment for.
async function listFacultyAllocationsForClass(client, classId) {
  return facultyAllocationRepository.findByClassId(client, classId);
}

// A staff member's full teaching schedule — the real, structured link
// AttendanceService's own "scheduled staff member" gap needed (see
// attendanceService.js, 82f8479 for where it was flagged, and its
// later patch for where it's actually wired in).
async function listFacultyAllocationsForStaff(client, staffUserId) {
  return facultyAllocationRepository.findByStaffUserId(client, staffUserId);
}

// null means no shared period exists for that (college, day, hour) —
// not an error, same convention as every other getX in this file.
// This is the lookup attendanceService.markAttendance uses to resolve
// a calendar date + hour_index into the shared timetable_periods row
// before it can ask "who's allocated to teach this class then."
async function getTimetablePeriod(client, collegeId, dayOfWeek, hourIndex) {
  return timetablePeriodRepository.findByCollegeDayAndHour(client, collegeId, dayOfWeek, hourIndex);
}

// null means no allocation exists for that (class, period) — not an
// error. The other half of the same lookup: once a period is
// resolved, this answers "which staff member (if any) is allocated to
// teach this specific class during it."
async function getFacultyAllocationForClassAndPeriod(client, classId, periodId) {
  return facultyAllocationRepository.findByClassAndPeriod(client, classId, periodId);
}

// Looks the allocation up first, both to get collegeId for the audit
// entry (this function takes no collegeId of its own, matching
// removeClass's signature) and to avoid logging a removal for an id
// that never existed. Hard DELETE, not soft-delete: neither
// faculty_allocation nor timetable_periods is named by
// BusinessRules.md's AI hard-delete restriction the way
// attendance_sessions is — same open-question treatment
// students/staff/classes already got.
async function removeFacultyAllocation(client, id, { actorUserId } = {}) {
  const allocation = await facultyAllocationRepository.findById(client, id);
  if (allocation === null) {
    return null;
  }

  await facultyAllocationRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: allocation.college_id,
    userId: actorUserId,
    action: 'faculty_allocation_removed',
    entity: 'faculty_allocation',
    entityId: id,
    metadata: null,
  });

  return allocation;
}

module.exports = {
  ClassValidationError,
  ClassTimetableStatusError,
  ClassNameConflictError,
  ClassTutorConflictError,
  ClassTutorNotFoundError,
  FacultyAllocationValidationError,
  FacultyAllocationClassNotFoundError,
  FacultyAllocationPeriodNotFoundError,
  FacultyAllocationStaffNotFoundError,
  FacultyAllocationPeriodTakenError,
  FacultyAllocationStaffConflictError,
  createClass,
  getClass,
  updateClass,
  removeClass,
  listClasses,
  assignFacultyAllocation,
  getFacultyAllocation,
  listFacultyAllocationsForClass,
  listFacultyAllocationsForStaff,
  removeFacultyAllocation,
  getTimetablePeriod,
  getFacultyAllocationForClassAndPeriod,
};
