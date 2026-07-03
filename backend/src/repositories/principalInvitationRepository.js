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
    `SELECT id, college_id, email, expires_at, accepted_at
     FROM principal_invitations WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

async function markInvitationAccepted(client, invitationId) {
  await client.query('UPDATE principal_invitations SET accepted_at = now() WHERE id = $1', [invitationId]);
}

module.exports = { createInvitation, getInvitationByTokenHash, markInvitationAccepted };
