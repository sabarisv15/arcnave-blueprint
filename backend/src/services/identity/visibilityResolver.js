'use strict';

// Identity-Migration-Plan.md Phase 3 — internal resolver module, only
// ever required by services/identityService.js (see
// positionResolver.js's docstring for the full "why internal, why no
// cross-resolver calls" reasoning — identical here).
//
// Resolves a user's visibility scope (Self/Department/College-wide),
// matching services/actorContextService.js's existing role-based
// scope logic (constants/roleScopeLevels.js's ROLE_SCOPE_LEVELS) — but
// derived from position/department data instead of `users.role`. This
// is the piece Phase 3's shadow comparison checks against
// actorContextService's own output for the SAME user, to prove the new
// model agrees with the old one before Phase 5/6 ever depend on it.
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
//   class + faculty-allocated classes), since that data is genuinely
//   person-centric (classRepository/facultyAllocationRepository key on
//   user_id, not on any position) and out of scope for the position
//   model per ADR-021's own "Level 4 ... not part of this account
//   model" line.
//
// Level 2 positions are deliberately NOT given a scope mapping here —
// v1's domain model leaves Level 2 configurable per-college by Level 1
// (Identity-Organization-Model.md), so there is no single fixed
// scope-level a Level 2 seat resolves to the way Level 1/3 do; deciding
// that is real Phase 5/6 policy work, not something this shadow-mode
// resolver should guess at.

const classRepository = require('../../repositories/classRepository');
const facultyAllocationRepository = require('../../repositories/facultyAllocationRepository');
const { SCOPE_LEVELS } = require('../../constants/scopeLevels');

const PRINCIPAL_LEVEL = 1;
const HOD_LEVEL = 3;

// Mirrors actorContextService.resolveAssignedClassIds exactly — same
// two sources, same de-dup-via-Set, same "tutor class first, then
// every faculty-allocated class" order. Duplicated rather than
// imported: actorContextService is the LEGACY comparison target, not a
// dependency of the new model — importing it here would make the
// shadow comparison compare identityService against itself.
async function resolveAssignedClassIds(client, userId) {
  const classIds = new Set();
  const tutorClass = await classRepository.findByTutorUserId(client, userId);
  if (tutorClass !== null) {
    classIds.add(tutorClass.id);
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
async function resolveVisibilityScope(client, { userId, positions, resolveDepartmentIds }) {
  const principalPosition = positions.find((p) => p.level === PRINCIPAL_LEVEL);
  if (principalPosition) {
    return { scopeLevel: SCOPE_LEVELS.COLLEGE, departmentIds: [], assignedClassIds: [] };
  }

  const hodPosition = positions.find((p) => p.level === HOD_LEVEL);
  if (hodPosition) {
    const departmentIds = await resolveDepartmentIds(hodPosition.positionId);
    return { scopeLevel: SCOPE_LEVELS.DEPARTMENT, departmentIds, assignedClassIds: [] };
  }

  const assignedClassIds = await resolveAssignedClassIds(client, userId);
  return { scopeLevel: SCOPE_LEVELS.SELF_ASSIGNED, departmentIds: [], assignedClassIds };
}

module.exports = { resolveVisibilityScope };
