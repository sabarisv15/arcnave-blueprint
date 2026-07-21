'use strict';

// Identity-Migration-Plan.md Phase 3 — the shadow-mode comparison +
// log-and-continue pipeline. This is the ONE business-service entry
// point middleware/identityShadow.js calls (CLAUDE.md rule 1); the
// middleware itself owns no business logic, only wiring this into the
// Express chain for the handful of routes Phase 3 enrolls.
//
// Composes identityService.resolveCapabilities (the new model's
// answer) against whatever legacy answer the caller already computed
// (permissions.js's role check + actorContextService's scope
// resolution — both already ran, upstream, before this is ever
// called; this module never re-derives them, only compares).
//
// Two hard invariants, both enforced here, not left to callers:
// 1. NEVER enroll a college that isn't at least BACKFILLED (Phase 2) —
//    a LEGACY college has empty position tables, so every comparison
//    would be a guaranteed false-positive mismatch (new tables empty
//    vs. old role data populated). This is the plan's own explicitly-
//    called-out "sequencing fix."
// 2. NEVER let anything here throw back to the caller, or take
//    meaningfully long — every DB call is inside one try/catch, and a
//    failure here becomes a logged error, not a request failure. This
//    is shadow mode: the legacy path has already decided the real
//    response by the time this runs.

const config = require('../config');
const collegeMigrationRepository = require('../repositories/collegeMigrationRepository');
const identityMismatchRepository = require('../repositories/identityMismatchRepository');
const identityService = require('./identityService');
const { logWarn, logError } = require('../logging/logger');

const ENROLLABLE_STATES = new Set(['BACKFILLED', 'SHADOW', 'WORKFLOW_V1', 'RBAC_V1', 'FULLY_MIGRATED']);

function sameIdSet(a, b) {
  const setA = new Set(a || []);
  const setB = new Set(b || []);
  if (setA.size !== setB.size) return false;
  for (const id of setA) {
    if (!setB.has(id)) return false;
  }
  return true;
}

// Exported separately so tests (and identityShadow.js itself) can
// check eligibility without running the full comparison — also the
// single place the LEGACY-exclusion rule lives, so it can never drift
// between "should I enroll" and "did I enroll" checks.
async function isCollegeEnrollable(client, collegeId) {
  if (!config.identityShadowModeEnabled) return false;
  const migrationState = await collegeMigrationRepository.getMigrationState(client, collegeId);
  return ENROLLABLE_STATES.has(migrationState);
}

// `legacy` carries whatever the already-executed legacy checks
// resolved for this exact request: { role, expectedRoles, scopeLevel,
// departmentIds }. expectedRoles is the permission's allowed-role list
// (PERMISSION_ROLES[permissionKey]) — the request already passed
// requirePermission by the time this runs, so `role` is guaranteed to
// be IN expectedRoles; the interesting question is only whether
// identityService's independently-derived effectiveRole agrees.
// scopeLevel/departmentIds are optional — pass them when the route
// also has a meaningful legacy scope answer to compare (e.g. via
// req.actorContext); omit them to compare role only.
async function compareAndLog(client, {
  collegeId, userId, requestId, route, permissionKey, legacy,
}) {
  try {
    const enrolled = await isCollegeEnrollable(client, collegeId);
    if (!enrolled) {
      return { enrolled: false, mismatches: [] };
    }

    const capabilities = await identityService.resolveCapabilities(client, { userId, collegeId });

    const mismatches = [];
    if (Array.isArray(legacy.expectedRoles) && !legacy.expectedRoles.includes(capabilities.effectiveRole)) {
      mismatches.push({
        type: 'role',
        detail: `identity resolved effectiveRole=${capabilities.effectiveRole}, legacy allowed=[${legacy.expectedRoles.join(',')}]`,
      });
    }
    if (legacy.scopeLevel && legacy.scopeLevel !== capabilities.scopeLevel) {
      mismatches.push({
        type: 'scope',
        detail: `identity scopeLevel=${capabilities.scopeLevel}, legacy scopeLevel=${legacy.scopeLevel}`,
      });
    }
    if (legacy.departmentIds && !sameIdSet(legacy.departmentIds, capabilities.departmentIds)) {
      mismatches.push({ type: 'department', detail: 'department id set differs from legacy resolution' });
    }

    for (const mismatch of mismatches) {
      // eslint-disable-next-line no-await-in-loop -- small, bounded set (at most 3 mismatch types), sequential logging is fine
      await identityMismatchRepository.recordMismatch(client, {
        collegeId,
        userId,
        requestId,
        route,
        permissionKey,
        mismatchType: mismatch.type,
        legacyRole: legacy.role,
        identityEffectiveRole: capabilities.effectiveRole,
        legacyScopeLevel: legacy.scopeLevel,
        identityScopeLevel: capabilities.scopeLevel,
        legacyDepartmentIds: legacy.departmentIds,
        identityDepartmentIds: capabilities.departmentIds,
        detail: mismatch.detail,
      });
      logWarn('identity_shadow_mismatch', {
        collegeId, userId, route, permissionKey, mismatchType: mismatch.type,
      });
    }

    return { enrolled: true, mismatches, capabilities };
  } catch (err) {
    // Per the plan: "never let the shadow call affect the actual
    // response or fail the request even if it throws." Log and swallow
    // — no PII in this log line either, same discipline as the
    // mismatch table itself.
    logError('identity_shadow_error', {
      collegeId, userId, route, permissionKey, error: err.message,
    });
    return { enrolled: false, mismatches: [], error: err.message };
  }
}

module.exports = { isCollegeEnrollable, compareAndLog };
