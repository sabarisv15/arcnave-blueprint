'use strict';

// ADR-024 (Session revocation — direct DB check, no cache layer yet) /
// Identity-Migration-Plan.md Phase 0.
//
// Must run after authMiddleware (decodes the JWT into req.jwtClaims,
// non-enforcing) and after tenantMiddleware (opens req.dbClient, the
// tenant-scoped transaction — token_version has to be read through
// that same RLS-scoped connection, same as any other tenant read).
//
// Gated entirely by config.sessionRevocationEnforced
// (SESSION_REVOCATION_ENFORCED): with the flag off (the default),
// this is a pure no-op on every request — zero behavior change to
// today's auth path, per the migration plan's Phase 0 rollback story
// ("disable flag; column stays, harmless if unchecked"). This is a
// direct DB read added to every authenticated request once enabled —
// ADR-024 explicitly requires measuring that cost via a load test
// before flipping the flag on anywhere shared, not assuming it's free.
//
// Deliberately does not reject a missing/invalid/expired token itself
// — that's requireAuth/requireRole/requirePermission's job downstream,
// same "decode is non-enforcing, RBAC enforces" split
// middleware/auth.js's own docstring establishes. This only adds one
// more rejection reason for a token that WAS structurally valid but
// names a now-stale token_version (e.g. after a password reset).
const config = require('../config');
const authService = require('../services/authService');

async function sessionRevocationMiddleware(req, res, next) {
  if (!config.sessionRevocationEnforced) {
    next();
    return;
  }

  const claims = req.jwtClaims;
  if (!claims || claims.type !== 'access' || typeof claims.token_version !== 'number') {
    next();
    return;
  }

  const currentVersion = await authService.getCurrentTokenVersion(req.dbClient, claims.sub);
  if (currentVersion === null || currentVersion !== claims.token_version) {
    res.status(401).json({ detail: 'Session has been revoked' });
    return;
  }

  next();
}

module.exports = { sessionRevocationMiddleware };
