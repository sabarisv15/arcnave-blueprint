'use strict';

// The single public façade over the Position/Institutional Position
// Account/Occupant model (ADR-021). PositionResolver / ModuleResolver
// / DepartmentResolver / AssignmentResolver / VisibilityResolver live
// as plain-function internal modules under services/identity/*, never
// exposed to routes or AI tools directly, never calling each other —
// only this façade composes them. Routes/AI tools/workflowChainService
// must only ever require THIS file, never services/identity/* directly
// (mirrors CLAUDE.md rule 1 — "every AI tool calls a Business
// Service" — one layer down: identityService is that Business Service
// for identity/capability questions).
//
// Not yet wired into any enforcement path (routes/permissions.js/
// aiToolRegistry.js are untouched) — this module's public contract is
// frozen (see docs/adr/ADR-022-Identity-Resolver-Contract.md) so that
// future consumers (workflowChainService, RBAC/AI tool cutover) can
// build directly on resolveCapabilities()'s return shape without
// reshaping it independently once they land.

const positionResolver = require('./identity/positionResolver');
const moduleResolver = require('./identity/moduleResolver');
const departmentResolver = require('./identity/departmentResolver');
const assignmentResolver = require('./identity/assignmentResolver');
const visibilityResolver = require('./identity/visibilityResolver');

const PRINCIPAL_LEVEL = 1;
const HOD_LEVEL = 3;

// The new model has no `role` string of its own (v1's whole point is
// to stop keying authorization off a flat users.role column) — but
// permissions.js/PERMISSION_ROLES, which IS keyed off role strings,
// needs something directly comparable. This derives the legacy-shaped
// role label a position implies, purely for comparison purposes:
// Level 1 -> 'principal', Level 3 -> 'hod', no active Level 1/3
// position -> 'staff' (the ADR-021 Level 4/person-centric default —
// see visibilityResolver's own docstring for why "no position found"
// is the expected staff case, not an error). A position holding BOTH
// is impossible today (nothing creates two positions for one user
// yet), but if it ever happens, Level 1 wins — same "lower level
// number outranks higher" precedent visibilityResolver already
// applies.
function deriveEffectiveRole(positions) {
  if (positions.some((p) => p.level === PRINCIPAL_LEVEL)) return 'principal';
  if (positions.some((p) => p.level === HOD_LEVEL)) return 'hod';
  return 'staff';
}

// The one public entry point. Resolves everything the legacy system's
// two separate mechanisms (permissions.js's role -> PERMISSION_ROLES
// lookup, actorContextService's role -> scope resolution) together
// produce for one user, from the new position/module/department data
// instead of users.role — a structure directly comparable to both.
//
// Returns:
//   {
//     userId, collegeId,
//     positions: [{ positionId, level, title, positionAccountId,
//                    currentOccupantUserId, moduleKeys, departmentIds }],
//     effectiveRole: 'principal' | 'hod' | 'staff',
//     scopeLevel: 'college' | 'department' | 'self_assigned',
//     departmentIds: string[],
//     assignedClassIds: string[],
//   }
//
// Never throws for "no position found" (that's the ordinary staff
// case) — only lets a genuine DB error propagate, same "the caller
// decides what a failure means" precedent every other service in this
// codebase follows. Any caller that needs to swallow errors (e.g. a
// best-effort comparison against a legacy value) is responsible for
// that at its own call site — that guard doesn't live in this
// function, so resolveCapabilities itself stays a normal, honestly-
// throwing function every caller can trust.
async function resolveCapabilities(client, { userId, collegeId }) {
  const activePositions = await positionResolver.resolveActivePositions(client, { collegeId, userId });

  // Sequential, not Promise.all: every resolver call below shares the
  // SAME connection (`client` is one pg Client/PoolClient — normally
  // the single per-request transaction connection tenant.js opens). A
  // single connection can only ever run one query at a time; issuing
  // several concurrently against it doesn't parallelize anything real
  // (pg itself just queues them) and node-postgres now deprecation-
  // warns on exactly this pattern. No behavior changes from being
  // sequential — this model has at most one or two active positions
  // per user in practice, so the extra round-trips are negligible.
  const positions = [];
  for (const position of activePositions) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential, single shared connection (see comment above)
    const moduleKeys = await moduleResolver.resolveOwnedModules(client, position.positionId);
    // eslint-disable-next-line no-await-in-loop -- see above
    const departmentIds = await departmentResolver.resolveMappedDepartments(client, position.positionId);
    // eslint-disable-next-line no-await-in-loop -- see above
    const currentOccupantUserId = await assignmentResolver.resolveCurrentOccupantUserId(client, position.positionAccountId);
    positions.push({
      ...position, moduleKeys, departmentIds, currentOccupantUserId,
    });
  }

  const visibility = await visibilityResolver.resolveVisibilityScope(client, {
    userId,
    positions,
    resolveDepartmentIds: (positionId) => departmentResolver.resolveMappedDepartments(client, positionId),
  });

  return {
    userId,
    collegeId,
    positions,
    effectiveRole: deriveEffectiveRole(positions),
    scopeLevel: visibility.scopeLevel,
    departmentIds: visibility.departmentIds,
    assignedClassIds: visibility.assignedClassIds,
  };
}

module.exports = { resolveCapabilities };
