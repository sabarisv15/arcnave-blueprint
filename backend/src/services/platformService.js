'use strict';

// Business logic for the Super Admin Portal API: platform-admin login,
// college creation, and principal invitation.
//
// invitePrincipal is Option B from Module-00-Platform.md's Known
// Limitations writeup (now resolved): this module records an
// invitation row and hands back a bearer token, but never writes to
// `users` itself — creating the actual account happens on the tenant
// side (see routes/invitations.js), through the normal RLS-protected
// tenant write path. arcnave_platform has no GRANT on
// users/refresh_tokens/audit_log/configurations (see the ported
// migrations) and gets none here either — only SELECT/INSERT/UPDATE
// on principal_invitations (0002 migration), so even a bug in this
// file could not reach tenant data.
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

const config = require('../config');
const security = require('../security');
const platformRepository = require('../repositories/platformRepository');
const principalInvitationRepository = require('../repositories/principalInvitationRepository');

// Generic platform-admin authentication failure — same single-
// message-for-every-failure-mode reasoning as AuthError in
// authService.js: unknown username and wrong password must look
// identical to the caller.
class PlatformAuthError extends Error {}

// college_id or subdomain already exists (colleges' two UNIQUE
// constraints).
class DuplicateCollegeError extends Error {}

// invitePrincipal's target college_id doesn't exist. Raised from a
// foreign_key_violation (23503) on the INSERT — principal_invitations
// has exactly one FK (college_id -> colleges), so any 23503 here
// unambiguously means this; no separate existence check needed,
// same reasoning as DuplicateCollegeError's unique_violation catch
// above.
class CollegeNotFoundError extends Error {}

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

// Records an invitation and returns the raw token — the route layer
// hands it back directly in the response body as a temporary stand-in
// for actually emailing an accept-link, since NotificationService
// doesn't exist yet (same pattern as password-reset's 501 stub). The
// raw token is never persisted — only its hash, via security.js's
// existing generateRefreshToken/hashRefreshToken, reused verbatim
// rather than duplicated: an invitation token has the same threat-
// model shape as a refresh token (server-generated high-entropy
// randomness), so the same reasoning for SHA-256 over argon2 applies
// unchanged.
async function invitePrincipal(pool, { collegeId, email, createdBy }) {
  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.principalInvitationExpireHours * 60 * 60 * 1000);
  let invitation;
  try {
    invitation = await principalInvitationRepository.createInvitation(pool, {
      collegeId,
      email,
      tokenHash: security.hashRefreshToken(rawToken),
      createdBy,
      expiresAt,
    });
  } catch (err) {
    // 23503 = foreign_key_violation.
    if (err.code === '23503') {
      throw new CollegeNotFoundError(`No college with college_id ${JSON.stringify(collegeId)}`);
    }
    throw err;
  }
  return {
    collegeId: invitation.college_id,
    email: invitation.email,
    token: rawToken,
    expiresAt: invitation.expires_at,
  };
}

module.exports = {
  PlatformAuthError,
  DuplicateCollegeError,
  CollegeNotFoundError,
  login,
  createCollege,
  invitePrincipal,
};
