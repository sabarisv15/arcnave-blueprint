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
const staffService = require('./staffService');

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

// updateStudent/removeStudent called by an actor outside their own
// scope: staff must be the tutor of the student's (current, and if
// changing, target) class; hod must be the hod of that class's (both
// classes', if changing) department; principal always qualifies for
// any student in their own college (RLS already guarantees the
// student is in-tenant, so no extra college check is needed beyond
// confirming the actor really is the college's principal). Any other
// role, or a role/scope mismatch, gets this one error — a caller only
// needs to know "not allowed," not which of the three checks failed.
class StudentNotAuthorizedError extends Error {}

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
// `actorUserId`/`actorRole` are optional: routes/students.js's GET
// route always supplies them (reads are now tutor/hod/principal-scoped,
// same as update/delete — see assertCanModifyStudent), but internal
// system callers that already know exactly which student they need
// (financeService.checkScholarshipEligibility, resolved via its own
// upstream authorization, not a raw students-API read) omit them on
// purpose and get the unscoped lookup they always have — actorRole
// undefined skips assertCanModifyStudent entirely rather than being
// treated as "no role, therefore no access."
async function getStudent(client, id, { actorUserId, actorRole } = {}) {
  const student = await studentRepository.findById(client, id);
  if (student === null) {
    return null;
  }
  if (actorRole !== undefined) {
    await assertCanModifyStudent(client, student, undefined, { actorUserId, actorRole });
  }
  return student;
}

// hod-of-department check shared by both the source-class and (if
// changing) target-class halves of assertCanModifyStudent's 'hod'
// branch below. staffService.findHodForDepartment throws
// StaffHodNotFoundError when nobody holds 'hod' for this department at
// all — collapsed into the same StudentNotAuthorizedError as an actual
// identity mismatch, since either way this actor isn't a verifiable
// hod of it.
async function assertIsHodOfDepartment(client, collegeId, departmentId, actorUserId, studentId) {
  let hod;
  try {
    hod = await staffService.findHodForDepartment(client, collegeId, departmentId);
  } catch (err) {
    if (err instanceof staffService.StaffHodNotFoundError) {
      throw new StudentNotAuthorizedError(`no hod found for department ${JSON.stringify(departmentId)}`);
    }
    throw err;
  }
  if (hod.user_id !== actorUserId) {
    throw new StudentNotAuthorizedError(`user ${JSON.stringify(actorUserId)} is not the hod of department ${JSON.stringify(departmentId)}, required to modify student ${JSON.stringify(studentId)}`);
  }
}

// The real gate behind students.update/students.delete's ['staff',
// 'hod', 'principal'] permission entry, AND (this session's own task)
// GET /students/:id's read scope via getStudent above — the same
// tutor-own-class/hod-own-department/principal-own-college boundary
// applies whether the actor is reading or writing, so one function
// covers both; a caller that only needs the read-only check simply
// passes `undefined` for targetClassId, same as removeStudent already
// does. Each role's actual
// authority is scoped to their own boundary, resolved from real
// assignments (classes.tutor_user_id, staff rows with role='hod'/
// 'principal') rather than trusted from the JWT role claim alone —
// same "resolve the real assignment, don't just check a role string"
// discipline academicService.js/staffService.js already use for
// tutor/hod/principal identity elsewhere. `targetClassId` is
// `undefined` for removeStudent (no class is changing) and for
// updateStudent calls that don't touch classId; `null` is a real,
// valid "unassign from any class" value, distinct from undefined.
//
// staff (tutor): may act on a student only while that student's
// CURRENT class is their own, and — if classId is part of the patch —
// only if the NEW value is also their own single class (classes.tutor_user_id
// is UNIQUE, so a tutor never has a second class to move a student
// into; any classId change at all is therefore rejected in practice,
// including unassigning to null).
//
// hod: may act on a student only while that student's CURRENT class
// belongs to their own department; if classId is changing to a
// DIFFERENT, non-null class, that target class's department must also
// be theirs. Changing classId to null (leaving the department
// entirely) is allowed without a target-side check — there is no
// target department to be hod of.
//
// principal: always authorized for any student already reachable in
// this session (RLS already guarantees same-college), once verified as
// the college's real principal. A non-null target classId still must
// resolve to a real class (StudentClassNotFoundError, not a silent
// pass) — the one existence check nothing else in this branch performs.
async function assertCanModifyStudent(client, student, targetClassId, { actorUserId, actorRole }) {
  const sourceClassId = student.class_id;

  if (actorRole === 'staff') {
    const tutorClass = await classRepository.findByTutorUserId(client, actorUserId);
    if (tutorClass === null || sourceClassId !== tutorClass.id
      || (targetClassId !== undefined && targetClassId !== tutorClass.id)) {
      throw new StudentNotAuthorizedError(`user ${JSON.stringify(actorUserId)} does not tutor student ${JSON.stringify(student.id)}'s class`);
    }
    return;
  }

  if (actorRole === 'hod') {
    const sourceClass = sourceClassId ? await classRepository.findById(client, sourceClassId) : null;
    if (sourceClass === null || !sourceClass.department_id) {
      throw new StudentNotAuthorizedError(`student ${JSON.stringify(student.id)} has no department-linked class to authorize against`);
    }
    await assertIsHodOfDepartment(client, student.college_id, sourceClass.department_id, actorUserId, student.id);

    if (targetClassId !== undefined && targetClassId !== null && targetClassId !== sourceClassId) {
      const targetClass = await classRepository.findById(client, targetClassId);
      if (targetClass === null) {
        throw new StudentClassNotFoundError(`classId ${JSON.stringify(targetClassId)} does not exist`);
      }
      if (!targetClass.department_id) {
        throw new StudentNotAuthorizedError(`class ${JSON.stringify(targetClassId)} has no department, cannot verify hod authorization`);
      }
      await assertIsHodOfDepartment(client, student.college_id, targetClass.department_id, actorUserId, student.id);
    }
    return;
  }

  if (actorRole === 'principal') {
    let principal;
    try {
      principal = await staffService.findPrincipal(client, student.college_id);
    } catch (err) {
      if (err instanceof staffService.StaffPrincipalNotFoundError) {
        throw new StudentNotAuthorizedError(`no principal found for college ${JSON.stringify(student.college_id)}`);
      }
      throw err;
    }
    if (principal.user_id !== actorUserId) {
      throw new StudentNotAuthorizedError(`user ${JSON.stringify(actorUserId)} is not the principal of college ${JSON.stringify(student.college_id)}`);
    }
    if (targetClassId !== undefined && targetClassId !== null && targetClassId !== sourceClassId) {
      const targetClass = await classRepository.findById(client, targetClassId);
      if (targetClass === null) {
        throw new StudentClassNotFoundError(`classId ${JSON.stringify(targetClassId)} does not exist`);
      }
    }
    return;
  }

  throw new StudentNotAuthorizedError(`role ${JSON.stringify(actorRole)} may not modify students`);
}

async function updateStudent(client, id, fields, { userId, actorRole }) {
  const patch = pickStudentFields(fields);
  const hasChanges = Object.keys(patch).length > 0;

  const student = await studentRepository.findById(client, id);
  if (student === null) {
    return null;
  }

  await assertCanModifyStudent(client, student, patch.classId, { actorUserId: userId, actorRole });

  let updated;
  try {
    updated = await studentRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505') {
      throw new StudentRollNoConflictError(`roll_no ${JSON.stringify(patch.rollNo)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'students_class_id_fkey') {
      throw new StudentClassNotFoundError(`classId ${JSON.stringify(patch.classId)} does not exist`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // studentRepository.update falls back to a plain findById then).
  if (hasChanges && updated !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: updated.college_id,
      userId,
      action: 'student_updated',
      entity: 'students',
      entityId: id,
      metadata: null,
    });
  }

  return updated;
}

// Looks the student up first, both to get collegeId for the audit
// entry (removeStudent's signature, per .ai/TASK.md, takes no
// collegeId of its own) and to avoid logging a removal for an id that
// never existed — and now also to run assertCanModifyStudent against
// its real class_id/college_id before the DELETE, same as updateStudent.
// Still a hard DELETE, not a soft-delete: the ERD has no soft-delete
// column yet — unchanged open question from the first slice, not
// resolved here either.
async function removeStudent(client, id, { userId, actorRole }) {
  const student = await studentRepository.findById(client, id);
  if (student === null) {
    return null;
  }

  await assertCanModifyStudent(client, student, undefined, { actorUserId: userId, actorRole });

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

// Same optional-actor convention as getStudent: routes/students.js's
// GET /students always supplies { actorUserId, actorRole, collegeId }
// (list is now tutor/hod/principal-scoped); reportService's full-college
// export (already principal-only-gated at its own route) omits them and
// gets the unscoped list, unchanged from before this session's task.
// staff/hod scope resolution has no repository-level LIMIT/OFFSET of
// its own (findByClassId/findByDepartmentId return the whole scoped
// set, same as findByClassId already did for Send Alert) — sliced here
// instead, since a tutor's roster or a department's roster is never
// large enough for that to matter, and it avoids two different
// pagination conventions for what's structurally the same lookup
// list()'s own LIMIT/OFFSET already covers for principal/unscoped.
async function listStudents(client, { limit = 50, offset = 0 } = {}, { actorUserId, actorRole, collegeId } = {}) {
  if (actorRole === undefined || actorRole === 'principal') {
    return studentRepository.list(client, { limit, offset });
  }
  if (actorRole === 'staff') {
    const tutorClass = await classRepository.findByTutorUserId(client, actorUserId);
    if (tutorClass === null) {
      return [];
    }
    const all = await studentRepository.findByClassId(client, tutorClass.id);
    return all.slice(offset, offset + limit);
  }
  if (actorRole === 'hod') {
    const departmentId = await staffService.findHodDepartmentId(client, collegeId, actorUserId);
    if (departmentId === null) {
      return [];
    }
    const all = await studentRepository.findByDepartmentId(client, departmentId);
    return all.slice(offset, offset + limit);
  }
  return [];
}

module.exports = {
  StudentValidationError,
  StudentRollNoConflictError,
  StudentNotClassTutorError,
  StudentClassMismatchError,
  StudentClassNotFoundError,
  StudentNotAuthorizedError,
  createStudent,
  getStudent,
  updateStudent,
  removeStudent,
  listStudents,
  // Exported for phoneVerificationService's own tutor/hod/principal
  // scope check on OTP request/verify (this session's own task) — the
  // exact same boundary as read/update/delete, reused rather than
  // reimplemented.
  assertCanModifyStudent,
};
