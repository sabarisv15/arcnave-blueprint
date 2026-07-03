'use strict';

// Faithful port of the deleted Python TenantMiddleware's
// responsibilities (recoverable via git history) — resolve college_id
// from (1) subdomain, (2) JWT claim, (3) explicit X-College-Code
// header, in that priority order; disagreement between present-and-
// resolved sources is a 400 reject, never a silent pick-one; open a
// per-request transaction and set_config('app.current_tenant', ...,
// true) if a tenant resolved.
//
// The one thing NOT a direct port: how "commit after the whole
// downstream chain finished successfully / rollback if it threw" is
// expressed. Starlette's `await call_next(request)` gives a single
// awaitable point — commit right after it returns, rollback in a
// surrounding except. Express's next() has no equivalent shape:
// calling it just continues the middleware chain; it is not a promise
// that resolves once downstream handling (including the route
// handler) has finished. `await next()` and committing immediately
// after would very likely commit before the route handler actually
// ran — a real bug, not a style difference.
//
// The correct Express pattern is two separate hooks:
//   - res.on('finish', ...) — fires once a response has actually been
//     sent, whether that response came from a route handler that
//     completed normally OR one that sent an intentional error
//     response directly (e.g. res.status(400).json(...) with no
//     throw). This is the commit path, matching the Python version's
//     behavior of committing on any response that came back through
//     call_next() without an uncaught exception escaping it.
//   - the 4-arg error-handling middleware (middleware/errorHandler.js)
//     — reached only when something calls next(err). This is the
//     rollback path.
// Both hooks can end up seeing the same request (the error handler's
// own response also eventually fires 'finish') — the `settled` flag
// below ensures whichever runs first (rollback, always first when an
// error occurred, since errorHandler awaits the rollback before
// sending its response) is the only one that actually touches the
// transaction; the other becomes a no-op. See
// tests/tenant-middleware.test.js's rollback-on-error case, which
// proves this sequencing empirically rather than assuming it from
// reading the code.

const { appPool } = require('../db/pool');

class TenantMismatchError extends Error {
  constructor(candidates) {
    super(`Conflicting tenant resolution: ${JSON.stringify(candidates)}`);
    this.name = 'TenantMismatchError';
    this.candidates = candidates;
  }
}

function extractSubdomain(req) {
  const host = (req.headers.host || '').split(':')[0];
  const labels = host.split('.');
  if (labels.length < 2) {
    // Bare host with no subdomain label (e.g. "localhost",
    // "127.0.0.1", "arcnave.com" itself) — not a tenant signal.
    return null;
  }
  const candidate = labels[0].trim().toLowerCase();
  return candidate || null;
}

function extractExplicitCode(req) {
  const raw = req.headers['x-college-code'];
  if (raw === undefined) return null;
  const code = String(raw).trim();
  return code || null;
}

async function lookupCollegeIdBySubdomain(client, subdomain) {
  const result = await client.query('SELECT college_id FROM colleges WHERE subdomain = $1', [subdomain]);
  return result.rows[0] ? result.rows[0].college_id : null;
}

async function lookupCollegeIdByCode(client, code) {
  const result = await client.query('SELECT college_id FROM colleges WHERE college_id = $1', [code]);
  return result.rows[0] ? result.rows[0].college_id : null;
}

async function resolveTenant(req, client) {
  const candidates = {};

  const subdomain = extractSubdomain(req);
  if (subdomain) {
    const resolved = await lookupCollegeIdBySubdomain(client, subdomain);
    if (resolved) candidates.subdomain = resolved;
  }

  // TODO(auth): req.jwtClaims is set by AuthMiddleware, which doesn't
  // exist yet — Module 0's slices are being rebuilt incrementally, in
  // the same order they were originally built (ADR-016). Until
  // AuthMiddleware exists, req.jwtClaims is always undefined and this
  // source can never contribute a candidate — this is not a stub or a
  // fake check, it's the same logic the Python version ran once its
  // own AuthMiddleware existed, just dormant until there's a claim to
  // read. An absent/invalid claim is simply "this source didn't
  // resolve," not an error, same as an unregistered subdomain below.
  const jwtClaims = req.jwtClaims;
  if (jwtClaims && jwtClaims.college_id) {
    const resolved = await lookupCollegeIdByCode(client, jwtClaims.college_id);
    if (resolved) candidates.jwt_claim = resolved;
  }

  const code = extractExplicitCode(req);
  if (code) {
    const resolved = await lookupCollegeIdByCode(client, code);
    if (resolved) candidates.explicit_code = resolved;
  }

  if (new Set(Object.values(candidates)).size > 1) {
    throw new TenantMismatchError(candidates);
  }

  for (const source of ['subdomain', 'jwt_claim', 'explicit_code']) {
    if (candidates[source]) return candidates[source];
  }
  return null;
}

async function tenantMiddleware(req, res, next) {
  let collegeId;
  try {
    const resolutionClient = await appPool.connect();
    try {
      collegeId = await resolveTenant(req, resolutionClient);
    } finally {
      resolutionClient.release();
    }
  } catch (err) {
    if (err instanceof TenantMismatchError) {
      res.status(400).json({ detail: err.message });
      return;
    }
    next(err);
    return;
  }

  let client;
  try {
    client = await appPool.connect();
    await client.query('BEGIN');
    if (collegeId !== null) {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    }
  } catch (err) {
    if (client) client.release();
    next(err);
    return;
  }

  let settled = false;

  const commitAndRelease = async () => {
    if (settled) return;
    settled = true;
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  };

  const rollbackAndRelease = async () => {
    if (settled) return;
    settled = true;
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  };

  req.dbClient = client;
  req.collegeId = collegeId;
  req.rollbackTransaction = rollbackAndRelease;

  res.on('finish', () => {
    commitAndRelease().catch((err) => {
      console.error('Failed to commit tenant-scoped transaction:', err);
    });
  });

  next();
}

module.exports = {
  TenantMismatchError,
  extractSubdomain,
  extractExplicitCode,
  lookupCollegeIdBySubdomain,
  lookupCollegeIdByCode,
  resolveTenant,
  tenantMiddleware,
};
