'use strict';

// Resolves the authenticated user's capabilities exactly once per
// request and caches the result on req.capabilities — the single
// per-request identity resolution Phase 1 (Capability Resolver
// integration) requires. Authorization (middleware/rbac.js) reads
// req.capabilities directly; deeper consumers that don't have `req`
// available (workflow routing, audit logging call sites) resolve
// their own answer at their own entry point instead of receiving this
// one, but always through the same identityService.resolveCapabilities
// — never a second implementation.
//
// Must run after authMiddleware (decodes the JWT into req.jwtClaims)
// and tenantMiddleware (opens req.dbClient, the tenant-scoped
// transaction) and sessionRevocationMiddleware (rejects a revoked
// session before this does any resolution work for it) — same
// ordering precedent middleware/sessionRevocation.js's own docstring
// establishes for the identical reason: this needs both a decoded
// claim and an open, RLS-scoped connection to resolve anything.
//
// Deliberately does not reject a missing/invalid/expired token itself
// — that's requireAuth/requireRole/requirePermission's job downstream,
// same "decode/resolve is non-enforcing, RBAC enforces" split
// middleware/auth.js's own docstring establishes.
const identityService = require('../services/identityService');

async function identityMiddleware(req, res, next) {
  const claims = req.jwtClaims;
  if (!claims || claims.type !== 'access') {
    next();
    return;
  }

  req.capabilities = await identityService.resolveCapabilities(req.dbClient, {
    userId: claims.sub,
    collegeId: req.collegeId,
  });
  next();
}

module.exports = { identityMiddleware };
