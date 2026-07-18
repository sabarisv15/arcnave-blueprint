'use strict';

// Builds ActorContext — the one-pass resolution of "who is this actor
// and what can they reach" that middleware/actorContext.js caches on
// req.actorContext, and that visibilityService.js's dual-input
// support builds internally from a legacy {actorUserId, actorRole}
// call. Reuses the exact lookups visibilityService.js already made
// per-call (classRepository.findByTutorUserId,
// facultyAllocationRepository.findByStaffUserId,
// staffService.findHodDepartmentId) — this is a foundation module,
// not a new resolution strategy.

const classRepository = require('../repositories/classRepository');
const facultyAllocationRepository = require('../repositories/facultyAllocationRepository');
const staffService = require('./staffService');
const { resolveScopeLevel } = require('../constants/roleScopeLevels');

// tutor-of-record class + every faculty-allocated (subject teacher)
// class, deduped — same union getVisibleClassIds's 'staff' branch
// computed inline before this module existed.
async function resolveAssignedClassIds(client, actorId) {
  const classIds = new Set();
  const tutorClass = await classRepository.findByTutorUserId(client, actorId);
  if (tutorClass !== null) {
    classIds.add(tutorClass.id);
  }
  const allocations = await facultyAllocationRepository.findByStaffUserId(client, actorId);
  for (const allocation of allocations) {
    classIds.add(allocation.class_id);
  }
  return [...classIds];
}

// The REAL department a user is verified hod of (staff+users lookup,
// never the JWT role claim alone) — empty array, not a throw, for
// "not a verifiable hod of anything," same convention
// staffService.findHodDepartmentId already established.
async function resolveDepartmentIds(client, tenantId, actorId) {
  const departmentId = await staffService.findHodDepartmentId(client, tenantId, actorId);
  return departmentId !== null ? [departmentId] : [];
}

// campusIds is reserved for future multi-campus colleges — every
// college is currently single-campus, so this is just [tenantId].
async function buildActorContext(client, { actorId, tenantId, role }) {
  const scopeLevel = resolveScopeLevel(role);
  const departmentIds = role === 'hod'
    ? await resolveDepartmentIds(client, tenantId, actorId)
    : [];
  const assignedClassIds = role === 'staff'
    ? await resolveAssignedClassIds(client, actorId)
    : [];

  return {
    actorId,
    tenantId,
    role,
    scopeLevel,
    departmentIds,
    assignedClassIds,
    campusIds: tenantId !== undefined && tenantId !== null ? [tenantId] : [],
  };
}

module.exports = { buildActorContext };
