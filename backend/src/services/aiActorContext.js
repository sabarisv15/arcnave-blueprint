'use strict';

// Phase 3 Group (c): renders the structured Identity Context block
// (Phase3-AI-Identity-Context-Integration.md decision 4) prepended to
// whatever system prompt reaches the LLM — a labeled block, not a
// prose sentence, since an LLM reasons more reliably from one. Reads
// only fields identityContext already carries (routes/ai.js's
// buildAiIdentityContext, sourced from req.capabilities) — same
// "AI is a consumer, not a decider" the Policy Gate already holds to:
// this function branches on the generic scopeLevel/role values both
// resolveCapabilities and resolveCapabilitiesForPosition produce,
// never on which resolver produced them.

const collegeProfileService = require('./collegeProfileService');
const academicService = require('./academicService');

const ROLE_LABELS = {
  principal: 'Principal',
  level2: 'Level 2',
  hod: 'HOD',
  class_tutor: 'Class Tutor',
  staff: 'Staff',
};

async function resolveScope(client, identityContext) {
  if (identityContext.scopeLevel === 'college') {
    return { scope: 'College-wide', access: 'College-level' };
  }

  if (identityContext.scopeLevel === 'department') {
    const department = identityContext.departmentId
      ? await collegeProfileService.getDepartment(client, identityContext.departmentId)
      : null;
    return {
      scope: department ? `${department.name} Department` : 'Own department',
      access: 'Department-level',
    };
  }

  if (identityContext.scopeLevel === 'self_assigned' || identityContext.scopeLevel === 'class') {
    const classIds = identityContext.classIds || [];
    if (classIds.length === 1) {
      // classRepository.findById returns the raw `SELECT *` row —
      // snake_case (class_name), not the camelCase COLUMNS mapping
      // (which only applies to inserts/updates) — see that file's own
      // findById.
      const cls = await academicService.getClass(client, classIds[0]);
      return { scope: cls ? cls.class_name : 'Own class', access: 'Class-level' };
    }
    if (classIds.length > 1) {
      return { scope: `${classIds.length} own classes`, access: 'Class-level' };
    }
    return { scope: 'Own class(es)', access: 'Class-level' };
  }

  // No scopeLevel resolved (e.g. an internal caller, or a role with no
  // scope mapping) — fails closed to "nothing," never "everything."
  return { scope: 'Unscoped', access: 'None' };
}

async function describeIdentityContext(client, identityContext) {
  const [profile, { scope, access }] = await Promise.all([
    identityContext.collegeId ? collegeProfileService.getProfile(client, identityContext.collegeId) : null,
    resolveScope(client, identityContext),
  ]);
  const institution = profile ? profile.name : identityContext.collegeId;
  const role = ROLE_LABELS[identityContext.role] || identityContext.role || 'Unknown';

  return [
    'Identity Context',
    `Role: ${role}`,
    `Scope: ${scope}`,
    `Institution: ${institution}`,
    `Access: ${access}`,
    'Restrictions: Do not answer outside this scope.',
  ].join('\n');
}

module.exports = { describeIdentityContext };
