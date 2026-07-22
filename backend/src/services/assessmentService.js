'use strict';

// Business logic for `assessment_types`/`assessment_marks` — validation
// and audit logging on top of assessmentTypeRepository.js/
// assessmentMarkRepository.js, neither of which do either (CLAUDE.md
// rule 1).
//
// BusinessRules.md Assessment marks: "the assigned Subject Faculty
// records assessment marks for their subject... the system stores the
// marks as entered without performing institutional internal mark
// calculations." No grade/best-of/weightage calculation exists
// anywhere in this file, deliberately — marksObtained is stored
// exactly as given, every time, forever. "Assessment types are
// institution-wide, configurable, editable by authorized
// administrators" — the actor check for create/updateAssessmentType is
// left to the route/RBAC layer (principal-only, same conservative
// default other institution-configuration actions in this codebase
// use), not resolved here.

const assessmentTypeRepository = require('../repositories/assessmentTypeRepository');
const assessmentMarkRepository = require('../repositories/assessmentMarkRepository');
const facultyAllocationRepository = require('../repositories/facultyAllocationRepository');
const classRepository = require('../repositories/classRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const visibilityService = require('./visibilityService');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');

// resolveAssessmentTypeId: mirrors studentService.resolveStudentId/
// staffService.resolveStaffId/academicService.resolveClassId — given
// either a real assessment_types id or its human-readable name (e.g.
// "Midterm"), returns the real id, or throws IdentifierResolutionError
// if neither resolves within this college. Same motivation: an AI
// Copilot caller only ever has the type's name to go on, never its
// internal id, and a guessed/invented value must be a clean
// rejection, not a raw Postgres uuid-cast crash out of
// assessmentMarkRepository's own WHERE clause.
async function resolveAssessmentTypeId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const assessmentType = await assessmentTypeRepository.findByName(client, collegeId, identifier);
  if (assessmentType === null) {
    throw new IdentifierResolutionError(
      `no assessment type found named ${JSON.stringify(identifier)} in this college`,
    );
  }
  return assessmentType.id;
}

class AssessmentTypeValidationError extends Error {}
class AssessmentTypeNameConflictError extends Error {}

class AssessmentMarkValidationError extends Error {}
class AssessmentMarkClassNotFoundError extends Error {}

// recordMark called by a user with no faculty_allocation row for this
// exact (class, subject) — BusinessRules.md: "only the assigned
// Subject Faculty can enter assessment marks." Checked against
// faculty_allocation's existing (class_id, subject, staff_user_id)
// shape, same free-text subject key that table already uses (see the
// migration's own comment on why this doesn't use the newer curriculum
// `subjects` table).
class AssessmentMarkNotAssignedFacultyError extends Error {}

async function createAssessmentType(client, { collegeId, name, maxMarks }, { actorUserId } = {}) {
  if (!collegeId || !name) {
    throw new AssessmentTypeValidationError('collegeId and name are required');
  }

  let assessmentType;
  try {
    assessmentType = await assessmentTypeRepository.create(client, {
      collegeId, name, maxMarks, createdByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'assessment_types_college_name_key') {
      throw new AssessmentTypeNameConflictError(`an assessment type named ${JSON.stringify(name)} already exists for this college`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId, userId: actorUserId, action: 'assessment_type_created', entity: 'assessment_types', entityId: assessmentType.id, metadata: null,
  });

  return assessmentType;
}

async function listAssessmentTypes(client, { limit, offset } = {}) {
  return assessmentTypeRepository.list(client, { limit, offset });
}

async function updateAssessmentType(client, id, fields, { actorUserId } = {}) {
  let assessmentType;
  try {
    assessmentType = await assessmentTypeRepository.update(client, id, fields);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'assessment_types_college_name_key') {
      throw new AssessmentTypeNameConflictError(`an assessment type named ${JSON.stringify(fields.name)} already exists for this college`);
    }
    throw err;
  }
  if (assessmentType === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: assessmentType.college_id, userId: actorUserId, action: 'assessment_type_updated', entity: 'assessment_types', entityId: id, metadata: null,
  });
  return assessmentType;
}

async function assertIsAssignedFaculty(client, classId, subject, actorUserId) {
  const allocations = await facultyAllocationRepository.findByClassId(client, classId);
  const isAssigned = allocations.some((a) => a.subject === subject && a.staff_user_id === actorUserId);
  if (!isAssigned) {
    throw new AssessmentMarkNotAssignedFacultyError(
      `user ${JSON.stringify(actorUserId)} is not the assigned Subject Faculty for ${JSON.stringify(subject)} in class ${JSON.stringify(classId)}`,
    );
  }
}

// Re-entry (the same student/assessment/class/subject slot) is an
// UPDATE, not a second row — same find-then-create/update shape
// attendanceService.markAttendance already establishes for its own
// per-slot upsert.
async function recordMark(client, {
  academicYear, classId, subject, assessmentTypeId, studentId, marksObtained,
}, { actorUserId } = {}) {
  if (!academicYear || !classId || !subject || !assessmentTypeId || !studentId || marksObtained === undefined || marksObtained === null) {
    throw new AssessmentMarkValidationError('academicYear, classId, subject, assessmentTypeId, studentId, and marksObtained are required');
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new AssessmentMarkClassNotFoundError(`class ${JSON.stringify(classId)} does not exist`);
  }
  await assertIsAssignedFaculty(client, classId, subject, actorUserId);

  const existing = await assessmentMarkRepository.findOne(client, {
    studentId, assessmentTypeId, classId, subject,
  });

  let mark;
  let wasUpdate;
  if (existing !== null) {
    mark = await assessmentMarkRepository.update(client, existing.id, { marksObtained, enteredByUserId: actorUserId });
    wasUpdate = true;
  } else {
    mark = await assessmentMarkRepository.create(client, {
      collegeId: cls.college_id, academicYear, classId, subject, assessmentTypeId, studentId, marksObtained, enteredByUserId: actorUserId,
    });
    wasUpdate = false;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: wasUpdate ? 'assessment_mark_updated' : 'assessment_mark_recorded',
    entity: 'assessment_marks',
    entityId: mark.id,
    metadata: { subject, assessmentTypeId },
  });

  return mark;
}

// BusinessRules.md: "mark entry uses filters such as Academic Year,
// Department, Class, Subject, and Assessment." departmentId is
// resolved to a list of classIds here (see
// assessmentMarkRepository.findByFilters' own comment on why that
// join doesn't live in the repository) — combined with an explicit
// classId if both are given, though naming both is an unusual caller
// choice, not one this function second-guesses.
async function listMarksForFilters(client, {
  academicYear, departmentId, classId, classIds: callerClassIds, subject, assessmentTypeId,
} = {}) {
  let classIds = callerClassIds;
  if (departmentId !== undefined) {
    const classesInDept = await classRepository.findByDepartmentId(client, departmentId);
    classIds = classesInDept.map((c) => c.id);
    if (classIds.length === 0) {
      return [];
    }
  }

  return assessmentMarkRepository.findByFilters(client, {
    academicYear, classId, classIds, subject, assessmentTypeId,
  });
}

// Scope-aware entry point for the assessment_marks_summary AI tool:
// resolves the actor's own visible classIds via
// visibilityService.getVisibleClassIds — the one shared resolver every
// scoped AI read uses (accepts this same {actorUserId, actorRole,
// collegeId} legacy shape directly) — never a caller-supplied classId/
// departmentId. null from getVisibleClassIds means "unrestricted"
// (principal), so no classIds filter is applied at all in that case.
// actorInput: either the legacy {actorUserId, actorRole, collegeId}
// shape or an already-built ActorContext (Phase 4 Group (a)) —
// forwarded straight into getVisibleClassIds unchanged either way; see
// analyticsService.getAttendanceRateForActor's own comment.
async function listMarksForActor(client, actorInput, { academicYear, subject, assessmentTypeId } = {}) {
  const classIds = await visibilityService.getVisibleClassIds(client, actorInput);
  if (classIds !== null && classIds.length === 0) {
    return [];
  }
  return assessmentMarkRepository.findByFilters(client, {
    academicYear,
    classIds: classIds !== null ? classIds : undefined,
    subject,
    assessmentTypeId,
  });
}

async function removeMark(client, id, { actorUserId } = {}) {
  const mark = await assessmentMarkRepository.softDelete(client, id);
  if (mark === null) {
    return null;
  }
  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: mark.college_id, userId: actorUserId, action: 'assessment_mark_removed', entity: 'assessment_marks', entityId: id, metadata: null,
  });
  return mark;
}

module.exports = {
  AssessmentTypeValidationError,
  AssessmentTypeNameConflictError,
  AssessmentMarkValidationError,
  AssessmentMarkClassNotFoundError,
  AssessmentMarkNotAssignedFacultyError,
  createAssessmentType,
  listAssessmentTypes,
  resolveAssessmentTypeId,
  updateAssessmentType,
  recordMark,
  listMarksForFilters,
  listMarksForActor,
  removeMark,
};
