'use strict';

// Phase 2 (Position Account Auth) step 6: the recursive invite-guard
// only, for Group (a)'s scope — Level 1/2/3. One generic, level-
// parametrized rule table rather than four bespoke invite flows, per
// the plan's decision 3 ("who invites whom" is a clean recursive
// pattern): Platform Admin -> Level 1/2. Level 2 -> HOD (Level 3)
// within their own college, any department. HOD -> Class Tutor within
// their own department's classes only — that last rule (and the
// idempotent provisioning/accept/email orchestration around all of
// this, inviteToPosition/acceptInvitation) is explicitly NOT this
// step's job; it lands once group (b)'s class-assignment schema exists
// (plan step 10) and once routes need the full flow (step 7 covers
// routes for L1/2/3 only, reusing this same guard).
//
// level/position_type are the two things that decide who may invite
// whom — never a role string, never req.jwtClaims.role. Level 1/2's
// rule is "actor is a Platform Admin" (a structurally different auth
// entirely — arcnave_platform's own JWT, no capabilities object at
// all); Level 3's rule reads the INVITING actor's own PERSONAL
// capabilities (identityService.resolveCapabilities, their ordinary
// users login) — an HOD inviting a Class Tutor, once that lands, acts
// from their ordinary login too, never a Position Account session
// inviting another Position Account.

const LEVEL2 = 2;

class PositionInvitationForbiddenError extends Error {}

// Thrown for a level/position_type combination this guard has no rule
// for yet (Level 4 with no position_type never reaches this at all —
// plain staff get no invitation flow; Level 4 + 'class_tutor' is a
// real future combination, just not wired until step 10) — distinct
// from PositionInvitationForbiddenError: this is "not built yet," not
// "you're not allowed."
class PositionInvitationLevelNotSupportedError extends Error {}

const RECURSIVE_INVITERS = {
  1: { scopeCheck: 'platform_admin' },
  2: { scopeCheck: 'platform_admin' },
  3: { requiredActorLevel: LEVEL2, scopeCheck: 'sameCollegeAnyDept' },
};

function inviterKeyFor({ level, positionType }) {
  if (level === 4 && positionType === 'class_tutor') return 'class_tutor';
  return level;
}

// The one thing this step delivers: given who's asking (a Platform
// Admin, or a tenant actor's own resolved PERSONAL capabilities) and
// what they want to invite someone into (targetLevel/targetPositionType/
// targetCollegeId), may they? Throws, never returns false — same
// "the guard fails loudly" convention every other assert* function in
// this codebase follows (e.g. assertLevelAllowsPositionLogin).
function assertCanInvite({
  actorIsPlatformAdmin, actorCapabilities, targetLevel, targetPositionType, targetCollegeId,
}) {
  const key = inviterKeyFor({ level: targetLevel, positionType: targetPositionType });
  const rule = RECURSIVE_INVITERS[key];
  if (!rule) {
    throw new PositionInvitationLevelNotSupportedError(
      `no invite rule defined yet for level ${JSON.stringify(targetLevel)}${targetPositionType ? ` position_type ${JSON.stringify(targetPositionType)}` : ''}`,
    );
  }

  if (rule.scopeCheck === 'platform_admin') {
    if (!actorIsPlatformAdmin) {
      throw new PositionInvitationForbiddenError('only a Platform Admin may invite to this level');
    }
    return;
  }

  if (actorIsPlatformAdmin) {
    throw new PositionInvitationForbiddenError('a Platform Admin may not invite to this level');
  }
  if (!actorCapabilities || !Array.isArray(actorCapabilities.positions)) {
    throw new PositionInvitationForbiddenError('actor has no resolved capabilities');
  }
  const holdsRequiredLevel = actorCapabilities.positions.some((p) => p.level === rule.requiredActorLevel);
  if (!holdsRequiredLevel) {
    throw new PositionInvitationForbiddenError(
      `actor must hold an active level ${rule.requiredActorLevel} position to invite level ${JSON.stringify(targetLevel)}`,
    );
  }

  if (rule.scopeCheck === 'sameCollegeAnyDept') {
    if (actorCapabilities.collegeId !== targetCollegeId) {
      throw new PositionInvitationForbiddenError('actor and target position must belong to the same college');
    }
    return;
  }

  // 'ownDepartmentOnly' (Class Tutor) isn't implemented until step 10
  // extends this guard — reaching here means inviterKeyFor already
  // matched 'class_tutor' but RECURSIVE_INVITERS doesn't define it
  // yet, which can't currently happen (the map above has no
  // 'class_tutor' entry, so inviterKeyFor would already have hit the
  // !rule branch first) — kept as an explicit guard, not a silent
  // fallthrough, for when that entry is added.
  throw new PositionInvitationLevelNotSupportedError(`scopeCheck ${JSON.stringify(rule.scopeCheck)} not implemented yet`);
}

module.exports = {
  PositionInvitationForbiddenError,
  PositionInvitationLevelNotSupportedError,
  RECURSIVE_INVITERS,
  assertCanInvite,
};
