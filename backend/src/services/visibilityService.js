'use strict';

// Central read-access authorization for every place student/class/
// staff data is reachable — one shared resolution instead of the
// tutor/hod/principal logic that used to be duplicated per-service
// (studentService.js's own assertCanViewStudent, before this file
// existed). CLAUDE.md rule 1/4: this is a Business Service, calls
// other Business Services (staffService) and repositories, never
// touches another repository's table through a repository-to-
// repository call.
//
// Every hod/principal check resolves the REAL assignment from
// staff+users (never the JWT role claim alone) via staffService's own
// findHodForDepartment/findPrincipal/findHodDepartmentId — the same
// "resolve the real assignment, don't just trust the role string"
// discipline studentService.js established first.

const classRepository = require('../repositories/classRepository');
const facultyAllocationRepository = require('../repositories/facultyAllocationRepository');
const studentRepository = require('../repositories/studentRepository');
const staffRepository = require('../repositories/staffRepository');
const staffService = require('./staffService');

// The one error every visibility check throws — a caller only needs to
// know "not allowed to view this," not which of several checks failed,
// same reasoning studentService.StudentNotAuthorizedError already
// settled on for the write-side equivalent.
class VisibilityForbiddenError extends Error {}

async function assertIsHodOfDepartment(client, collegeId, departmentId, actorUserId) {
  let hod;
  try {
    hod = await staffService.findHodForDepartment(client, collegeId, departmentId);
  } catch (err) {
    if (err instanceof staffService.StaffHodNotFoundError) {
      throw new VisibilityForbiddenError(`no hod found for department ${JSON.stringify(departmentId)}`);
    }
    throw err;
  }
  if (hod.user_id !== actorUserId) {
    throw new VisibilityForbiddenError(`user ${JSON.stringify(actorUserId)} is not the hod of department ${JSON.stringify(departmentId)}`);
  }
}

async function assertIsPrincipalOfCollege(client, collegeId, actorUserId) {
  let principal;
  try {
    principal = await staffService.findPrincipal(client, collegeId);
  } catch (err) {
    if (err instanceof staffService.StaffPrincipalNotFoundError) {
      throw new VisibilityForbiddenError(`no principal found for college ${JSON.stringify(collegeId)}`);
    }
    throw err;
  }
  if (principal.user_id !== actorUserId) {
    throw new VisibilityForbiddenError(`user ${JSON.stringify(actorUserId)} is not the principal of college ${JSON.stringify(collegeId)}`);
  }
}

// staff: tutor-of-record OR faculty-allocated (subject teacher) —
// broader than write access (studentService.assertCanModifyStudent
// stays tutor-only on purpose, per this session's own constraint, and
// does not call this function). hod: every class in their own, real,
// verified department. principal: unrestricted within the tenant (RLS
// already scopes reads to one college, so null here means exactly
// that, not literally every class in the DB). college_admin/anything
// else: no visibility, per this session's own task ("no
// student-private class visibility unless explicitly allowed").
// actorRole === undefined means an internal system caller — also
// unrestricted, same convention studentService.js already established
// for getStudent/listStudents.
async function getVisibleClassIds(client, { collegeId, actorUserId, actorRole }) {
  if (actorRole === undefined || actorRole === 'principal') {
    return null;
  }
  if (actorRole === 'staff') {
    const classIds = new Set();
    const tutorClass = await classRepository.findByTutorUserId(client, actorUserId);
    if (tutorClass !== null) {
      classIds.add(tutorClass.id);
    }
    const allocations = await facultyAllocationRepository.findByStaffUserId(client, actorUserId);
    for (const allocation of allocations) {
      classIds.add(allocation.class_id);
    }
    return [...classIds];
  }
  if (actorRole === 'hod') {
    const departmentId = await staffService.findHodDepartmentId(client, collegeId, actorUserId);
    if (departmentId === null) {
      return [];
    }
    const classes = await classRepository.findByDepartmentId(client, departmentId);
    return classes.map((cls) => cls.id);
  }
  return [];
}

async function assertCanViewClass(client, classId, { actorUserId, actorRole, collegeId }) {
  const visibleIds = await getVisibleClassIds(client, { collegeId, actorUserId, actorRole });
  if (visibleIds === null || visibleIds.includes(classId)) {
    return;
  }
  throw new VisibilityForbiddenError(
    `role ${JSON.stringify(actorRole)} (user ${JSON.stringify(actorUserId)}) may not view class ${JSON.stringify(classId)}`,
  );
}

// studentOrId may be an already-resolved student row (the common case
// — every existing caller already did its own findById for a 404
// check first) or a bare id.
async function resolveStudent(client, studentOrId) {
  if (studentOrId !== null && typeof studentOrId === 'object') {
    return studentOrId;
  }
  return studentRepository.findById(client, studentOrId);
}

async function assertCanViewStudent(client, studentOrId, { actorUserId, actorRole }) {
  const student = await resolveStudent(client, studentOrId);
  if (student === null) {
    return; // caller's own 404, not this function's concern
  }

  if (actorRole === 'staff') {
    if (student.class_id !== null) {
      const visibleIds = await getVisibleClassIds(client, { collegeId: student.college_id, actorUserId, actorRole });
      if (visibleIds.includes(student.class_id)) {
        return;
      }
    }
    throw new VisibilityForbiddenError(`user ${JSON.stringify(actorUserId)} does not tutor or teach student ${JSON.stringify(student.id)}'s class`);
  }

  if (actorRole === 'hod') {
    const sourceClass = student.class_id ? await classRepository.findById(client, student.class_id) : null;
    if (sourceClass === null || !sourceClass.department_id) {
      throw new VisibilityForbiddenError(`student ${JSON.stringify(student.id)} has no department-linked class to authorize against`);
    }
    await assertIsHodOfDepartment(client, student.college_id, sourceClass.department_id, actorUserId);
    return;
  }

  if (actorRole === 'principal') {
    await assertIsPrincipalOfCollege(client, student.college_id, actorUserId);
    return;
  }

  throw new VisibilityForbiddenError(`role ${JSON.stringify(actorRole)} may not view students`);
}

// target: { staffId } or { userId } to resolve one, or an
// already-resolved staff row (skips the lookup). GET /staff/:id names
// a staff.id (the profile row), not a user_id, so routes/staff.js
// passes { staffId }.
async function resolveStaffTarget(client, target) {
  if (target !== null && typeof target === 'object') {
    if (target.staffId !== undefined) {
      return staffRepository.findById(client, target.staffId);
    }
    if (target.userId !== undefined) {
      return staffRepository.findByUserId(client, target.userId);
    }
    return target;
  }
  return staffRepository.findById(client, target);
}

// self always. hod sees their own (real, verified) department's staff.
// principal/college_admin see the whole college directory — a staff
// row has no student-linked or aadhaar field to withhold (unlike
// documents/students), so "operational/profile staff directory" per
// BusinessRules.md's College Admin scope is exactly this table,
// college-wide, same as principal gets. Ordinary staff cannot view
// another staff member's profile.
async function assertCanViewStaff(client, target, { actorUserId, actorRole }) {
  const staff = await resolveStaffTarget(client, target);
  if (staff === null) {
    return null;
  }
  if (staff.user_id === actorUserId) {
    return staff;
  }
  if (actorRole === 'principal' || actorRole === 'college_admin') {
    return staff;
  }
  if (actorRole === 'hod' && staff.department_id) {
    const departmentId = await staffService.findHodDepartmentId(client, staff.college_id, actorUserId);
    if (departmentId !== null && departmentId === staff.department_id) {
      return staff;
    }
  }
  throw new VisibilityForbiddenError(
    `role ${JSON.stringify(actorRole)} (user ${JSON.stringify(actorUserId)}) may not view staff ${JSON.stringify(staff.id)}`,
  );
}

module.exports = {
  VisibilityForbiddenError,
  assertIsHodOfDepartment,
  assertIsPrincipalOfCollege,
  getVisibleClassIds,
  assertCanViewClass,
  assertCanViewStudent,
  resolveStaffTarget,
  assertCanViewStaff,
};
