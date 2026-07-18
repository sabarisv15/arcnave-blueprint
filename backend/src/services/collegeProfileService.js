'use strict';

// Business logic for the college profile slice — validation and
// audit logging on top of collegeProfileRepository.js/
// departmentRepository.js, neither of which does either (CLAUDE.md
// rule 1). Originally a College Admin duty; BusinessRules.md's College
// Admin — final model made College Admin an ARCNAVE support employee
// with no tenant role, so principal is now the only role that
// reads/writes this file's two resources — enforced at the
// route/RBAC layer (requirePermission), not here (same division every
// other service in this codebase draws).
//
// getProfile/updateProfile touch exactly the three columns
// collegeProfileRepository.js owns (affiliating_university/
// year_established/address) — no validation beyond "at least one
// field provided," since none of the three is NOT NULL at the DB
// level and Postgres itself is the type backstop (a non-numeric
// yearEstablished simply errors as a real DB type-mismatch, not
// silently coerced).
//
// Departments: name is the one NOT NULL column
// (UNIQUE(college_id, name)); approvedIntake is nullable. Hard
// DELETE, matching departmentRepository.js's own comment (no
// soft-delete column exists on this table).

const collegeProfileRepository = require('../repositories/collegeProfileRepository');
const departmentRepository = require('../repositories/departmentRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

// createDepartment/updateDepartment given no name (create) — NOT NULL
// at the DB level, raised before any repository call, same as every
// other pre-query guard in this codebase.
class DepartmentValidationError extends Error {}

// departments_college_id_name_key (UNIQUE (college_id, name))
// violated (Postgres 23505) — this department name already exists in
// this college.
class DepartmentNameConflictError extends Error {}

async function getProfile(client, collegeId) {
  return collegeProfileRepository.getByCollegeId(client, collegeId);
}

async function updateProfile(client, collegeId, fields, { actorUserId } = {}) {
  const profile = await collegeProfileRepository.updateProfile(client, collegeId, fields);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'college_profile_updated',
    entity: 'colleges',
    entityId: collegeId,
    metadata: null,
  });

  return profile;
}

async function listDepartments(client, collegeId) {
  return departmentRepository.findByCollege(client, collegeId);
}

async function getDepartment(client, id) {
  return departmentRepository.findById(client, id);
}

async function createDepartment(client, { collegeId, name, approvedIntake }, { actorUserId } = {}) {
  if (!name) {
    throw new DepartmentValidationError('name is required');
  }

  let department;
  try {
    department = await departmentRepository.create(client, { collegeId, name, approvedIntake });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'departments_college_id_name_key') {
      throw new DepartmentNameConflictError(`department ${JSON.stringify(name)} already exists in this college`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'department_created',
    entity: 'departments',
    entityId: department.id,
    metadata: null,
  });

  return department;
}

async function updateDepartment(client, id, fields, { actorUserId } = {}) {
  let department;
  try {
    department = await departmentRepository.update(client, id, fields);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'departments_college_id_name_key') {
      throw new DepartmentNameConflictError(`department ${JSON.stringify(fields.name)} already exists in this college`);
    }
    throw err;
  }
  if (department === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: department.college_id,
    userId: actorUserId,
    action: 'department_updated',
    entity: 'departments',
    entityId: id,
    metadata: null,
  });

  return department;
}

async function removeDepartment(client, id, { actorUserId, collegeId } = {}) {
  const department = await departmentRepository.findById(client, id);
  if (department === null) {
    return null;
  }

  await departmentRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: collegeId || department.college_id,
    userId: actorUserId,
    action: 'department_removed',
    entity: 'departments',
    entityId: id,
    metadata: null,
  });

  return department;
}

module.exports = {
  DepartmentValidationError,
  DepartmentNameConflictError,
  getProfile,
  updateProfile,
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  removeDepartment,
};
