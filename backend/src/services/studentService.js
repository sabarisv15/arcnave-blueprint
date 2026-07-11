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

async function createStudent(client, { collegeId, rollNo, fullName, userId, ...rest }) {
  if (!rollNo || !fullName) {
    throw new StudentValidationError('rollNo and fullName are required');
  }

  let student;
  try {
    student = await studentRepository.create(client, {
      collegeId,
      rollNo,
      fullName,
      ...pickStudentFields(rest),
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new StudentRollNoConflictError(`roll_no ${JSON.stringify(rollNo)} already exists for this college`);
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
  createStudent,
  getStudent,
  updateStudent,
  removeStudent,
  listStudents,
};
