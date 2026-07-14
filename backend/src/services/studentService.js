'use strict';

// Business logic for Module 1's `students` table — validation and
// audit logging on top of studentRepository.js, which does neither
// (CLAUDE.md rule 1: AI tools call Business Services, never
// repositories directly — this file is what makes that possible for
// students).
//
// "Only the class tutor may edit" (BusinessRules.md Staff) is an
// authorization rule, not business logic — left to the route/RBAC
// layer once Module 1's API exists, same as how configurationService.js
// left "writes gated to principal only" to routes/configurations.js,
// not to itself. No WorkflowService call either: it doesn't exist yet
// (Roadmap.md builds Workflow/Notifications after Attendance/Finance),
// so BusinessRules.md's HOD-override exception for student-profile
// edits is out of scope here, not stubbed.

const studentRepository = require('../repositories/studentRepository');
const classRepository = require('../repositories/classRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

// Missing roll_no or full_name — StudentEditorModal.jsx marks both
// required and blocks its own "Next" step without them. Raised before
// any repository call, same as configurationService's pre-read guard
// against a nonsensical expectedVersion.
class StudentValidationError extends Error {}

// UNIQUE (college_id, roll_no) violated (Postgres 23505,
// students_college_id_roll_no_key). Never let the raw pg error reach
// the caller, same discipline as configurationService.js's
// ConfigurationVersionConflictError / platformService.js's
// DuplicateCollegeError.
class StudentRollNoConflictError extends Error {}

// createStudent called by a user who is not classes.tutor_user_id for
// any class — student creation is scoped to "the assigned Class Tutor,
// for their own class" (BusinessRules.md Staff), so a staff member with
// no class assigned yet has nothing to create a student against.
class StudentNotClassTutorError extends Error {}

// createStudent called with an explicit classId that does not match
// the actor's own resolved class. classes.tutor_user_id is UNIQUE (see
// the Module 3 migration), so an actor is never tutor of more than one
// class today — this can only be reached by a caller supplying a
// classId that isn't theirs, never by genuine ambiguity between two of
// their own classes. Rejected rather than silently overridden with the
// resolved class ("don't guess" — a caller-supplied value that
// disagrees with reality is a caller error, not this service's call to
// make).
class StudentClassMismatchError extends Error {}

// students_class_id_fkey violated (Postgres 23503) on create. Not
// expected to be reachable in practice — class_id is always the
// service's own just-resolved, real classes.id, never caller input —
// but mapped anyway (rather than left to leak a raw pg error) since
// this is the same createStudent code path StudentRollNoConflictError
// already guards, and a future change to how class_id is resolved
// should fail the same clean way this file's other FK violations do.
class StudentClassNotFoundError extends Error {}

// The fields this service accepts for create/update, deliberately
// listed here rather than trusting studentRepository's own COLUMNS
// whitelist to be the only line of defense — same defense-in-depth
// reasoning as passing collegeId explicitly through an
// already-tenant-scoped client (authService.js). collegeId is
// excluded on purpose: a student's tenant is set once at creation and
// never moves via update. There is no aadhaar entry here and there
// never should be (CLAUDE.md rule 8) — any aadhaar-shaped field a
// caller sends is silently dropped by pickStudentFields, not rejected
// with an error; picked over throwing because every other unknown
// field (typos, future frontend fields not yet wired up) gets the
// same silent-drop treatment, and singling aadhaar out for a loud
// rejection would be the only special case in this function.
const ALLOWED_FIELDS = [
  'rollNo',
  'fullName',
  'gender',
  'entryType',
  'emisNumber',
  'umisNumber',
  'email',
  'phone',
  'phoneVerified',
  'parentName',
  'parentPhone',
  'parentPhoneVerified',
  'address',
  'pincode',
  'mark10th',
  'mark12th',
  'markIti',
  'accommodation',
  'club',
  'internship',
  'careerPlan',
  'notes',
  'licenseNumber',
  'bikeNumber',
  'annualIncome',
  // Which class this student is enrolled in (students.class_id — see
  // that migration's own comment). Still caller-settable via
  // updateStudent (e.g. a principal reassigning a student to a
  // different class) — but NOT via createStudent, which resolves and
  // sets class_id itself from the actor's own tutor_user_id match
  // (never trusts client input for it — see createStudent's own
  // comment). Listed here once for pickStudentFields' shared use by
  // both; createStudent destructures classId off its input before this
  // list is ever consulted, so it can never reach the repository via
  // that path regardless.
  'classId',
];

function pickStudentFields(source) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

// classId is destructured off separately from the rest of the caller's
// input (never merged into pickStudentFields' output for this path) —
// student creation is scoped to "the assigned Class Tutor, for their
// own class" (BusinessRules.md Staff), so class_id is always resolved
// server-side from classes.tutor_user_id = userId, never trusted from
// the client. A caller-supplied classId is still accepted as an
// explicit assertion of "this is my class" and validated against the
// resolved class (StudentClassMismatchError if it disagrees) rather
// than silently ignored — same "don't guess" reasoning
// StudentClassMismatchError's own comment gives.
async function createStudent(client, {
  collegeId, rollNo, fullName, userId, classId: assertedClassId, ...rest
}) {
  if (!rollNo || !fullName) {
    throw new StudentValidationError('rollNo and fullName are required');
  }

  const tutorClass = await classRepository.findByTutorUserId(client, userId);
  if (tutorClass === null) {
    throw new StudentNotClassTutorError(`user ${JSON.stringify(userId)} is not the tutor of any class`);
  }
  if (assertedClassId !== undefined && assertedClassId !== null && assertedClassId !== tutorClass.id) {
    throw new StudentClassMismatchError(`classId ${JSON.stringify(assertedClassId)} is not a class user ${JSON.stringify(userId)} tutors`);
  }

  let student;
  try {
    student = await studentRepository.create(client, {
      collegeId,
      rollNo,
      fullName,
      classId: tutorClass.id,
      ...pickStudentFields(rest),
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new StudentRollNoConflictError(`roll_no ${JSON.stringify(rollNo)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'students_class_id_fkey') {
      throw new StudentClassNotFoundError(`classId ${JSON.stringify(tutorClass.id)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'student_created',
    entity: 'students',
    entityId: student.id,
    metadata: null,
  });

  return student;
}

// null means no student exists with this id — not an error. The
// route turns that into 404, same as configurationService.getConfiguration.
async function getStudent(client, id) {
  return studentRepository.findById(client, id);
}

async function updateStudent(client, id, fields, { userId }) {
  const patch = pickStudentFields(fields);
  const hasChanges = Object.keys(patch).length > 0;

  let student;
  try {
    student = await studentRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505') {
      throw new StudentRollNoConflictError(`roll_no ${JSON.stringify(patch.rollNo)} already exists for this college`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // studentRepository.update falls back to a plain findById then).
  // student !== null guards the id-not-found case. Either way, no row
  // was actually changed, so no audit entry.
  if (hasChanges && student !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: student.college_id,
      userId,
      action: 'student_updated',
      entity: 'students',
      entityId: id,
      metadata: null,
    });
  }

  return student;
}

// Looks the student up first, both to get collegeId for the audit
// entry (removeStudent's signature, per .ai/TASK.md, takes no
// collegeId of its own) and to avoid logging a removal for an id that
// never existed. Still a hard DELETE, not a soft-delete: the ERD has
// no soft-delete column yet — unchanged open question from the first
// slice, not resolved here either.
async function removeStudent(client, id, { userId }) {
  const student = await studentRepository.findById(client, id);
  if (student === null) {
    return null;
  }

  await studentRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId,
    action: 'student_removed',
    entity: 'students',
    entityId: id,
    metadata: null,
  });

  return student;
}

async function listStudents(client, { limit, offset } = {}) {
  return studentRepository.list(client, { limit, offset });
}

module.exports = {
  StudentValidationError,
  StudentRollNoConflictError,
  StudentNotClassTutorError,
  StudentClassMismatchError,
  StudentClassNotFoundError,
  createStudent,
  getStudent,
  updateStudent,
  removeStudent,
  listStudents,
};
