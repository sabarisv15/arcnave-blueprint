'use strict';

// Identity-Migration-Plan.md Phase 3 — wiring only. Mounts
// services/identityShadowService.js's compare-and-log pipeline onto a
// specific route, AFTER that route's own requirePermission(...) in the
// middleware chain (see routes/collegeProfile.js and routes/aiConfig.js
// for the two routes this phase enrolls) — by the time this runs, the
// legacy permission check has ALREADY decided the real response;
// nothing this file does can change that.
//
// Deliberately awaited, not fire-and-forget: req.dbClient is the
// single, per-request transaction connection tenant.js opens and
// commits/rolls back around the whole request (see
// middleware/tenant.js's own docstring) — a truly fire-and-forget
// query against that same client could still be mid-flight when the
// response commits/releases the connection back to the pool, which
// would be a real bug (query against a released client), not a
// performance optimization. Awaiting here keeps the shadow check
// safely inside the request's existing transaction lifecycle; the
// safety guarantee ("never affects the actual response") comes from
// every failure mode being caught and logged, never thrown or written
// to `res`, not from being unawaited. This does add real latency to
// enrolled requests while the flag is on — exactly the cost the plan's
// "Performance testing... before Phase 3 shadow-mode goes live at
// scale" missing-phase item calls out as needing to be measured, not
// assumed; this phase enrolls only a handful of low-risk GET routes
// for that reason.
//
// `permissionKey` must be a real key in permissions.js's
// PERMISSION_ROLES — this middleware reads that table directly (not
// duplicated) so the "legacy expected roles" side of the comparison
// can never drift from the actual enforcement table.

const config = require('../config');
const { PERMISSION_ROLES } = require('./permissions');
const { buildActorContext } = require('../services/actorContextService');
const identityShadowService = require('../services/identityShadowService');
const { logError } = require('../logging/logger');

function shadowCompare(permissionKey) {
  return async function identityShadowMiddleware(req, res, next) {
    if (!config.identityShadowModeEnabled) {
      next();
      return;
    }

    try {
      const expectedRoles = PERMISSION_ROLES[permissionKey] || [];
      const legacyActorContext = await buildActorContext(req.dbClient, {
        actorId: req.jwtClaims.sub,
        tenantId: req.collegeId,
        role: req.jwtClaims.role,
      });

      await identityShadowService.compareAndLog(req.dbClient, {
        collegeId: req.collegeId,
        userId: req.jwtClaims.sub,
        requestId: req.requestId,
        route: req.originalUrl.split('?')[0],
        permissionKey,
        legacy: {
          role: req.jwtClaims.role,
          expectedRoles,
          scopeLevel: legacyActorContext.scopeLevel,
          departmentIds: legacyActorContext.departmentIds,
        },
      });
    } catch (err) {
      // Belt-and-suspenders on top of identityShadowService's own
      // internal try/catch: this guards buildActorContext's call too
      // (legacy code, not shadow-service code) — same "log, never
      // throw, never touch res" contract either way.
      logError('identity_shadow_middleware_error', {
        collegeId: req.collegeId, permissionKey, error: err.message,
      });
    }

    next();
  };
}

module.exports = { shadowCompare };
