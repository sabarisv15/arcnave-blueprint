'use strict';

// Internal resolver module, NOT a separately-callable service (see
// ADR-022) — same "only identityService.js may require this, resolvers
// never call each other" rule positionResolver.js's own docstring
// establishes, mirrored here.
//
// Resolves the Position occupying a given structural slot — the
// inverse direction of positionResolver (user -> positions; this one
// goes slot -> position). A "slot" is either a college-wide structural
// level (collegeId + level, e.g. the Level 1 Principal seat) or a
// department (a department has at most one active owning position at
// a time, per position_department_assignments' own unique-active-per-
// department index — regardless of that position's level, so a
// departmentId alone resolves it unambiguously, no level filter
// needed).

const positionRepository = require('../../repositories/positionRepository');

async function resolvePositionIdByCollegeLevel(client, collegeId, level) {
  const position = await positionRepository.findActivePositionByCollegeAndLevel(client, collegeId, level);
  return position ? position.id : null;
}

async function resolvePositionIdByDepartment(client, departmentId) {
  const assignment = await positionRepository.findActiveDepartmentAssignment(client, departmentId);
  return assignment ? assignment.position_id : null;
}

// Returns { positionId, positionAccountId } for the position currently
// occupying the given slot, or null if no position is assigned to it
// (a vacant slot is the ordinary case, not an error — same convention
// every other resolver in this directory follows).
async function resolvePositionForSlot(client, { collegeId, level, departmentId }) {
  const positionId = departmentId
    ? await resolvePositionIdByDepartment(client, departmentId)
    : await resolvePositionIdByCollegeLevel(client, collegeId, level);
  if (positionId === null) {
    return null;
  }

  const account = await positionRepository.findPositionAccountByPositionId(client, positionId);
  if (account === null) {
    return null;
  }

  return { positionId, positionAccountId: account.id };
}

module.exports = { resolvePositionForSlot };
