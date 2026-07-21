'use strict';

// BusinessRules.md Configurable approval workflow: "ARCNAVE shall
// provide a configurable workflow engine that allows each institution
// to define approval hierarchies for different modules... Different
// modules may use different chains, such as Tutor, HOD, Principal, or
// College Admin combinations." (College Admin is excluded from the
// role vocabulary below — BusinessRules.md's own College Admin —
// final model made College Admin an ARCNAVE support employee with no
// seat in any tenant, so it can never be a resolvable in-tenant
// approver; see Staff/Multi-tenancy.)
//
// This is the ONE real engine every submitX workflow function in this
// codebase should eventually call instead of hardcoding its own
// approverChain array inline (academicService.submitTimetableForApproval/
// financeService.submitFeeStructureApproval/curriculumService.
// requestCurriculumMigration/attendanceService.requestAttendanceCorrection/
// studentService.requestInternalTransfer+requestInterCollegeTransfer+
// requestLifecycleStatusChange all still build their own chain inline
// today — retrofitting each is mechanical once this resolver exists,
// deliberately left for a fast-follow, not bundled into this same
// change: swapping the approver-resolution logic under N already-
// working, already-tested submit functions in one sweep is real
// regression risk this slice chooses not to take at once).
// academicService.submitTimetableForApproval is retrofitted here as
// the one proof this resolver actually works end to end.
//
// "Workflow changes apply only to new requests" needs no separate
// version-tracking column: workflowService.submitRequest already
// snapshots the resolved approver_chain into the workflow_requests row
// itself (JSONB, written once at submission) — a later config change
// can never retroactively alter an already-submitted row, since
// nothing re-reads config for an existing request. That guarantee
// already existed structurally; this file only adds where the chain
// comes from.
//
// DEFAULT_CHAINS matches every existing hardcoded chain in this
// codebase exactly — an institution that never configures anything
// gets identical behavior to today, not a behavior change by omission.

const configurationService = require('./configurationService');
const positionRepository = require('../repositories/positionRepository');
const classRepository = require('../repositories/classRepository');
const workflowDelegationRepository = require('../repositories/workflowDelegationRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

const WORKFLOW_CHAIN_CONFIG_CATEGORY = 'workflow_chains';

const DEFAULT_CHAINS = {
  timetable_approval: ['hod', 'principal'],
  fee_structure: ['principal'],
  curriculum_migration: ['principal'],
  attendance_correction: ['tutor'],
  student_transfer: ['principal'],
  student_lifecycle_change: ['principal'],
  // BusinessRules.md Data retention and archival: "restoration of
  // archived records follows the institution's approval workflow."
  record_restoration: ['principal'],
};

const KNOWN_ROLES = ['principal', 'hod', 'tutor'];

class WorkflowChainValidationError extends Error {}
class WorkflowChainUnknownEntityTypeError extends Error {}
class WorkflowChainUnknownRoleError extends Error {}

// departmentId required for 'hod', classId required for 'tutor' — a
// chain naming one of those roles without the context to resolve it
// is a caller bug (missing context), not a business-data problem.
class WorkflowChainMissingContextError extends Error {}

async function resolveOccupantForPosition(client, positionId) {
  const account = await positionRepository.findPositionAccountByPositionId(client, positionId);
  if (account === null) {
    return null;
  }
  return positionRepository.findActiveOccupant(client, account.id);
}

// Resolves 'principal'/'hod' via the Capability Resolver's own data
// (positionRepository — Position/Position Account/Occupant, ADR-021)
// instead of staffService's users.role-based lookups: workflow routing
// is one of the four consumers Phase 1 moves onto the Position model
// as the single source of truth, so this must not keep its own
// parallel "who is the HOD/Principal" logic once that model owns the
// answer. staffService.ensureHodPosition/swapHodOccupant (staffService.js)
// keep a department's Level 3 occupant in sync on every HOD/Acting-HOD
// change, so an active HOD In-Charge appointee is simply the current
// occupant here too — no separate in-charge fallback needed, unlike
// the staffService.findHodForDepartment lookup this replaces.
async function resolveRoleUserId(client, role, { collegeId, classId, departmentId }) {
  if (role === 'principal') {
    const position = await positionRepository.findActivePositionByCollegeAndLevel(client, collegeId, 1);
    const occupant = position && await resolveOccupantForPosition(client, position.id);
    if (occupant === null || occupant === undefined) {
      throw new WorkflowChainMissingContextError(`college ${JSON.stringify(collegeId)} has no active Principal to resolve a "principal" chain step`);
    }
    return occupant.user_id;
  }
  if (role === 'hod') {
    if (!departmentId) {
      throw new WorkflowChainMissingContextError('departmentId is required to resolve an "hod" chain step');
    }
    const assignment = await positionRepository.findActiveDepartmentAssignment(client, departmentId);
    const occupant = assignment && await resolveOccupantForPosition(client, assignment.position_id);
    if (occupant === null || occupant === undefined) {
      throw new WorkflowChainMissingContextError(`department ${JSON.stringify(departmentId)} has no active HOD (permanent or acting) to resolve an "hod" chain step`);
    }
    return occupant.user_id;
  }
  if (role === 'tutor') {
    if (!classId) {
      throw new WorkflowChainMissingContextError('classId is required to resolve a "tutor" chain step');
    }
    const cls = await classRepository.findById(client, classId);
    if (cls === null || !cls.tutor_user_id) {
      throw new WorkflowChainMissingContextError(`class ${JSON.stringify(classId)} has no tutor assigned to resolve a "tutor" chain step`);
    }
    return cls.tutor_user_id;
  }
  throw new WorkflowChainUnknownRoleError(`role ${JSON.stringify(role)} is not a known chain role (${KNOWN_ROLES.join(', ')})`);
}

// BusinessRules.md: "temporary delegation supports start date, end
// date, reason, and delegated approver." Checked per resolved role,
// after the base resolution above — a delegation substitutes the
// approver, it never changes which roles a chain requires.
async function applyDelegationIfActive(client, role, baseUserId, { collegeId, departmentId, date }) {
  const delegation = await workflowDelegationRepository.findActive(client, {
    collegeId, role, departmentId: role === 'hod' ? departmentId : null, date,
  });
  return delegation === null ? baseUserId : delegation.delegate_user_id;
}

// BusinessRules.md: "each institution configures its own approval
// chain per module." Reads category 'workflow_chains', key
// entityType — falls back to DEFAULT_CHAINS[entityType] when the
// institution hasn't configured this module (or hasn't configured
// anything at all yet), never a hard failure for an unconfigured but
// otherwise-known module.
async function resolveApproverChain(client, {
  collegeId, entityType, classId, departmentId,
}, { date } = {}) {
  if (!collegeId || !entityType) {
    throw new WorkflowChainValidationError('collegeId and entityType are required');
  }

  const config = await configurationService.getConfiguration(client, { collegeId, category: WORKFLOW_CHAIN_CONFIG_CATEGORY });
  const configuredChain = config && config.configuration ? config.configuration[entityType] : undefined;
  const roles = configuredChain || DEFAULT_CHAINS[entityType];
  if (!roles) {
    throw new WorkflowChainUnknownEntityTypeError(`no chain configured or defaulted for entityType ${JSON.stringify(entityType)}`);
  }

  const effectiveDate = date || new Date().toISOString().slice(0, 10);
  const chain = [];
  for (let i = 0; i < roles.length; i += 1) {
    const role = roles[i];
    // eslint-disable-next-line no-await-in-loop
    const baseUserId = await resolveRoleUserId(client, role, { collegeId, classId, departmentId });
    // eslint-disable-next-line no-await-in-loop
    const userId = await applyDelegationIfActive(client, role, baseUserId, { collegeId, departmentId, date: effectiveDate });
    chain.push({ step: i + 1, role, user_id: userId });
  }

  return chain;
}

async function createDelegation(client, {
  role, departmentId, delegateUserId, startDate, endDate, reason,
}, { actorUserId, collegeId } = {}) {
  if (!KNOWN_ROLES.includes(role)) {
    throw new WorkflowChainUnknownRoleError(`role ${JSON.stringify(role)} is not a known chain role (${KNOWN_ROLES.join(', ')})`);
  }
  if (!delegateUserId || !startDate) {
    throw new WorkflowChainValidationError('delegateUserId and startDate are required');
  }

  const delegation = await workflowDelegationRepository.create(client, {
    collegeId, role, departmentId, delegateUserId, startDate, endDate, reason, delegatedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId, userId: actorUserId, action: 'workflow_delegation_created', entity: 'workflow_delegations', entityId: delegation.id, metadata: { role },
  });

  return delegation;
}

async function revokeDelegation(client, id, { actorUserId } = {}) {
  const delegation = await workflowDelegationRepository.revoke(client, id, { revokedByUserId: actorUserId });
  if (delegation === null) {
    return null;
  }
  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: delegation.college_id, userId: actorUserId, action: 'workflow_delegation_revoked', entity: 'workflow_delegations', entityId: id, metadata: null,
  });
  return delegation;
}

async function listDelegations(client, collegeId) {
  return workflowDelegationRepository.listForCollege(client, collegeId);
}

module.exports = {
  WORKFLOW_CHAIN_CONFIG_CATEGORY,
  DEFAULT_CHAINS,
  WorkflowChainValidationError,
  WorkflowChainUnknownEntityTypeError,
  WorkflowChainUnknownRoleError,
  WorkflowChainMissingContextError,
  resolveApproverChain,
  createDelegation,
  revokeDelegation,
  listDelegations,
};
