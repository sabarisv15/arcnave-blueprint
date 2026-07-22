'use strict';

// Internal resolver module, only ever required by
// services/identityService.js (see positionResolver.js's docstring for
// the full "why internal, why no cross-resolver calls" reasoning —
// identical here).
//
// Resolves a user's visibility scope (Self/Department/College-wide),
// matching services/actorContextService.js's existing role-based
// scope logic (constants/roleScopeLevels.js's ROLE_SCOPE_LEVELS) — but
// derived from position/department data instead of `users.role`. This
// output is the reference the new model must continue agreeing with
// actorContextService's own output on, for the same user, before any
// future caller (workflowChainService, RBAC/AI tool cutover) depends
// on it.
//
// Mapping (v1 domain model, frozen — Identity-Organization-Model.md):
// - An active Level 1 position (Principal-equivalent) -> COLLEGE scope,
//   same reach ROLE_SCOPE_LEVELS.principal grants today.
// - An active Level 3 position (HOD-equivalent) -> DEPARTMENT scope,
//   scoped to whichever department(s) that position is mapped to via
//   position_department_assignments (departmentResolver) — same reach
//   ROLE_SCOPE_LEVELS.hod grants today (actorContextService currently
//   only ever resolves one department for an hod; this mirrors that,
//   using the first mapped department if more than one somehow exists,
//   the same "there should only ever be one" precedent
//   positionRepository.findActivePositionByCollegeAndLevel documents).
// - No active Level 1/3 position -> SELF_ASSIGNED scope (the Level
//   4/person-centric default, per ADR-021 — Level 4 has no `positions`
//   row at all in v1, so "no position found" IS the staff case, not an
//   error) — assignedClassIds computed exactly as
//   actorContextService.resolveAssignedClassIds does (tutor-of-record
//   class + faculty-allocated classes) — faculty-allocated classes stay
//   genuinely person-centric (facultyAllocationRepository keys on
//   user_id, not any position); tutor-of-record moved onto the Position
//   model in Phase 2 step 12 (see resolveAssignedClassIds below).
//
// Level 2 positions have no fixed scope-level the way Level 1/3 do —
// v1's domain model leaves them Principal-configurable (Identity-
// Architecture.md §5.2 / ADR-021). The configuration mechanism is the
// same position_department_assignments table Level 3 already uses:
// if Level 1 has assigned a Level 2 position one or more departments,
// that IS the Principal-defined policy, and it resolves to DEPARTMENT
// scope over exactly those departments. No assignment configured for
// it yet (the only case that exists anywhere today) falls straight
// through to the ordinary staff/SELF_ASSIGNED default below — never a
// hardcoded Level 2-specific scope.

const facultyAllocationRepository = require('../../repositories/facultyAllocationRepository');
const { SCOPE_LEVELS } = require('../../constants/scopeLevels');

const PRINCIPAL_LEVEL = 1;
const HOD_LEVEL = 3;
const LEVEL_2 = 2;

// Mirrors actorContextService.resolveAssignedClassIds exactly — same
// two sources, same de-dup-via-Set, same "tutor class first, then
// every faculty-allocated class" order. Duplicated rather than
// imported: actorContextService is the LEGACY comparison target, not a
// dependency of the new model — importing it here would make any
// future comparison compare identityService against itself.
//
// Phase 2 step 12: the tutor-of-record half moved off
// classRepository.findByTutorUserId (classes.tutor_user_id) onto the
// Position/Account/Occupant model — resolveActiveClassTutorClassId is
// injected (a () => Promise<string|null> thunk) rather than this
// module requiring positionRepository/classResolver directly, same
// "resolvers never call another resolver module, only identityService
// composes them" reasoning resolveDepartmentIds below already follows
// (identityService.resolveActiveClassTutorPosition is itself built on
// positionRepository + classResolver — this is the highest-scrutiny
// call site since it's a named resolveCapabilities internal consumer,
// ADR-022 — so the injection keeps this module's own layering rule
// intact rather than reaching around it for one convenient exception).
async function resolveAssignedClassIds(client, userId, { resolveActiveClassTutorClassId }) {
  const classIds = new Set();
  const tutorClassId = await resolveActiveClassTutorClassId();
  if (tutorClassId !== null) {
    classIds.add(tutorClassId);
  }
  const allocations = await facultyAllocationRepository.findByStaffUserId(client, userId);
  for (const allocation of allocations) {
    classIds.add(allocation.class_id);
  }
  return [...classIds];
}

// `positions` is positionResolver's output for this user (already
// resolved by the caller — identityService — so this resolver doesn't
// need to reach into position_occupants itself); `resolveDepartmentIds`
// is a function(positionId) -> Promise<string[]>, normally
// departmentResolver.resolveMappedDepartments, injected rather than
// required directly so this module never calls another resolver module
// itself (identityService is the only thing allowed to compose them).
async function resolveVisibilityScope(client, {
  userId, positions, resolveDepartmentIds, resolveActiveClassTutorClassId,
}) {
  const principalPosition = positions.find((p) => p.level === PRINCIPAL_LEVEL);
  if (principalPosition) {
    return { scopeLevel: SCOPE_LEVELS.COLLEGE, departmentIds: [], assignedClassIds: [] };
  }

  const hodPosition = positions.find((p) => p.level === HOD_LEVEL);
  if (hodPosition) {
    const departmentIds = await resolveDepartmentIds(hodPosition.positionId);
    return { scopeLevel: SCOPE_LEVELS.DEPARTMENT, departmentIds, assignedClassIds: [] };
  }

  const level2Position = positions.find((p) => p.level === LEVEL_2);
  if (level2Position) {
    const departmentIds = await resolveDepartmentIds(level2Position.positionId);
    if (departmentIds.length > 0) {
      return { scopeLevel: SCOPE_LEVELS.DEPARTMENT, departmentIds, assignedClassIds: [] };
    }
  }

  const assignedClassIds = await resolveAssignedClassIds(client, userId, { resolveActiveClassTutorClassId });
  return { scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED, departmentIds: [], assignedClassIds };
}

module.exports = { resolveVisibilityScope };
