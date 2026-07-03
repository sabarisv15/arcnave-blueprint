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
//   - intercepting res.end (see below) for the commit path — reached
//     whenever a response is about to be sent, whether that response
//     came from a route handler that completed normally OR one that
//     sent an intentional error response directly (e.g.
//     res.status(400).json(...) with no throw). Matches the Python
//     version's behavior of committing on any response that came back
//     through call_next() without an uncaught exception escaping it.
//   - the 4-arg error-handling middleware (middleware/errorHandler.js)
//     — reached only when something calls next(err). This is the
//     rollback path.
// The `settled` flag below ensures whichever runs first (rollback,
// always first when an error occurred, since errorHandler awaits the
// rollback before sending its response) is the only one that actually
// touches the transaction; the other becomes a no-op. See
// tests/tenant-middleware.test.js's rollback-on-error case, which
// proves this sequencing empirically rather than assuming it from
// reading the code.
//
// **The commit path was originally res.on('finish', ...) and that was
// a real, live bug, found empirically, not by inspection.** 'finish'
// fires only *after* Node has already flushed the response to the
// client's socket — meaning a fast client could receive a "success"
// response and immediately issue a follow-up request (e.g. login,
// then refresh, in tests/auth.test.js) that raced the COMMIT itself.
// Caught via a rapid login-then-refresh diagnostic that reproduced
// "Invalid refresh token" on a token that had just been issued,
// consistently, once the sequence ran tightly enough — the exact
// class of bug this project's "prove it, don't assume it" tests exist
// to catch, just discovered a slice later than the code that caused
// it. Fixed by intercepting res.end (the low-level method every
// response helper — res.json, res.send, res.status().json() —
// eventually calls): commit first, and only call the real res.end
// once the commit has actually completed.

const { appPool } = require('../db/pool');
const { getRequestContext } = require('../logging/context');
const { logError } = require('../logging/logger');

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

  // req.jwtClaims is set by AuthMiddleware (middleware/auth.js),
  // registered before this middleware in app.js so it always runs
  // first. An absent/invalid claim (no bearer token, expired,
  // tampered) already left req.jwtClaims null there — that's simply
  // "this source didn't resolve," same as an unregistered subdomain,
  // not a separate error path here. The claimed college_id still goes
  // through the same DB existence check as the explicit-code source
  // below: a validly-signed JWT proves the claim wasn't tampered
  // with, not that the college it names still exists.
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

  // Mutates the AsyncLocalStorage store requestContextMiddleware
  // already opened for this request, in place, rather than opening a
  // second nested context — collegeId starts null there and this is
  // the one place it becomes known. This is what lets a log line from
  // deep inside authService.refresh() (which only ever receives
  // `client`, never `req`) still pick up collegeId automatically, the
  // same way it already picks up requestId.
  const context = getRequestContext();
  if (context) context.collegeId = collegeId;

  // Every response path (res.json, res.send, an explicit res.end(),
  // and errorHandler.js's own res.status(500).json(...)) funnels
  // through res.end eventually — intercepting it here is the one
  // choke point that reliably runs before any byte reaches the
  // client, regardless of which helper the route handler used.
  const originalEnd = res.end.bind(res);
  res.end = (...args) => {
    res.end = originalEnd;
    commitAndRelease()
      .then(() => originalEnd(...args))
      .catch((err) => {
        logError('failed_to_commit_tenant_scoped_transaction', {
          requestId: req.requestId,
          collegeId: req.collegeId,
          error: err.message,
        });
        // The route handler already believes it succeeded (it called
        // res.json/res.end with a success body) — but the commit
        // genuinely failed, so telling the client otherwise would be
        // worse than this bug ever was. Nothing has been flushed to
        // the socket yet (this runs before originalEnd), so it's
        // still safe to override with a real error response.
        if (!res.headersSent) {
          res.status(500).json({ detail: 'Internal server error' });
        } else {
          originalEnd();
        }
      });
  };

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
