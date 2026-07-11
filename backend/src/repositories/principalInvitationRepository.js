'use strict';

// Query mechanics for `principal_invitations` only — no business
// logic (see services/platformService.js for creation,
// routes/invitations.js for acceptance).
//
// Unlike every other repository in this codebase, functions here are
// called from both sides of the platform/tenant split: createInvitation
// runs against platformPool (arcnave_platform), getInvitationByTokenHash/
// markInvitationAccepted run against a tenant-role connection
// (arcnave_app — either the short-lived lookup client
// routes/invitations.js opens before it knows a collegeId, or
// req.dbClient afterward). That's safe because a pg client/pool here
// is just a connection handle — which role's permissions actually
// apply is enforced by Postgres GRANT on the connection itself (see
// the ported 0002 migration), not by anything in this file.
// arcnave_app has no INSERT grant on this table, so createInvitation
// would fail at the DB level if ever called with a tenant-role
// connection; that's a feature, not a gap this file needs to guard
// against itself.

async function createInvitation(pool, { collegeId, email, tokenHash, createdBy, expiresAt }) {
  const result = await pool.query(
    `INSERT INTO principal_invitations (college_id, email, token_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, college_id, email, expires_at, created_at`,
    [collegeId, email, tokenHash, createdBy, expiresAt],
  );
  return result.rows[0];
}

async function getInvitationByTokenHash(client, tokenHash) {
  const result = await client.query(
    `SELECT id, college_id, email, expires_at, accepted_at, revoked_at
     FROM principal_invitations WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

async function getInvitationById(pool, invitationId) {
  const result = await pool.query(
    `SELECT id, college_id, email, expires_at, accepted_at, revoked_at, created_at
     FROM principal_invitations WHERE id = $1`,
    [invitationId],
  );
  return result.rows[0] || null;
}

async function markInvitationAccepted(client, invitationId) {
  await client.query('UPDATE principal_invitations SET accepted_at = now() WHERE id = $1', [invitationId]);
}

// Rotates token_hash/expires_at on an existing, still-pending
// (never accepted, never revoked) invitation — resend reuses the SAME
// row rather than creating a second one, so there is never more than
// one live invitation per original invite action. The WHERE guard is
// the real backstop (same "let the DB be the actual backstop"
// discipline as everywhere else in this codebase): a concurrent
// accept/revoke racing this call means zero rows come back, not a
// silently-wrong token issued for an invitation that's no longer
// resendable.
async function resendInvitation(pool, invitationId, { tokenHash, expiresAt }) {
  const result = await pool.query(
    `UPDATE principal_invitations SET token_hash = $2, expires_at = $3
     WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
     RETURNING id, college_id, email, expires_at, created_at`,
    [invitationId, tokenHash, expiresAt],
  );
  return result.rows[0] || null;
}

// Same WHERE-guard reasoning as resendInvitation: an already-accepted
// or already-revoked invitation is simply not touched (null returned),
// never silently re-revoked or revoked-after-accepted.
async function revokeInvitation(pool, invitationId) {
  const result = await pool.query(
    `UPDATE principal_invitations SET revoked_at = now()
     WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
     RETURNING id, college_id, email, revoked_at`,
    [invitationId],
  );
  return result.rows[0] || null;
}

module.exports = {
  createInvitation,
  getInvitationByTokenHash,
  getInvitationById,
  markInvitationAccepted,
  resendInvitation,
  revokeInvitation,
};
