'use strict';

// Business logic for the Super Admin Portal API: platform-admin login
// and college creation only, this pass (matching the deleted Python
// version's own original scope before principal invitation was added
// later — that slice is still not built here either, per the build
// order in Module-00-Platform.md).
//
// This module only ever touches platform_admins/colleges — no path to
// users/refresh_tokens/audit_log/configurations exists here, and
// arcnave_platform has no GRANT on those tables regardless (see the
// ported migrations), so even a bug couldn't reach them.
//
// No per-request transaction wrapping here, unlike tenant routes —
// deliberately, not an oversight. Every operation in this pass is a
// single statement (one SELECT for login, one INSERT for college
// creation); Postgres autocommits a standalone statement with no
// explicit BEGIN, so there is no cross-statement atomicity requirement
// to protect the way tenant routes have one (set_config(...) and the
// query it scopes MUST share one transaction, or RLS fails closed on
// the very next statement — see tenant.js). Routes call these
// functions with `platformPool` directly, not a checked-out client;
// node-postgres's Pool exposes the same .query() interface, and
// letting the pool manage checkout/release per call is simpler than
// introducing a request-scoped transaction middleware this pass has
// no actual need for.

const security = require('../security');
const platformRepository = require('../repositories/platformRepository');

// Generic platform-admin authentication failure — same single-
// message-for-every-failure-mode reasoning as AuthError in
// authService.js: unknown username and wrong password must look
// identical to the caller.
class PlatformAuthError extends Error {}

// college_id or subdomain already exists (colleges' two UNIQUE
// constraints).
class DuplicateCollegeError extends Error {}

async function login(pool, { username, password }) {
  const admin = await platformRepository.getPlatformAdminByUsername(pool, username);
  if (!admin || !(await security.verifyPassword(password, admin.password_hash))) {
    throw new PlatformAuthError('Invalid username or password');
  }
  const accessToken = security.createPlatformAccessToken({ adminId: admin.id });
  return { accessToken, tokenType: 'bearer' };
}

async function createCollege(pool, { collegeId, name, subdomain, createdBy }) {
  try {
    return await platformRepository.createCollege(pool, { collegeId, name, subdomain, createdBy });
  } catch (err) {
    // 23505 = unique_violation (Postgres SQLSTATE) — colleges has two
    // UNIQUE constraints (college_id, subdomain), either one failing
    // lands here. No need to distinguish which for the caller, same
    // as the deleted Python version's single DuplicateCollegeError
    // catching both.
    if (err.code === '23505') {
      throw new DuplicateCollegeError('college_id or subdomain already exists');
    }
    throw err;
  }
}

module.exports = { PlatformAuthError, DuplicateCollegeError, login, createCollege };
