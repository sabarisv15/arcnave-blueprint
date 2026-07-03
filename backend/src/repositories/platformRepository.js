'use strict';

// Query mechanics for `platform_admins` and `colleges` only — the
// Platform layer's two tables (ADR-010). Never
// users/refresh_tokens/audit_log/configurations; arcnave_platform has
// no GRANT on those regardless (see the ported migrations), so a
// query against them here would fail at the DB level even if someone
// tried. No business logic in this file — see
// services/platformService.js for that.
//
// No principal_invitations here — that repository/table is a later
// slice, not this pass's scope (login + college creation only).

async function getPlatformAdminByUsername(client, username) {
  const result = await client.query(
    'SELECT id, username, email, password_hash FROM platform_admins WHERE username = $1',
    [username],
  );
  return result.rows[0] || null;
}

async function createCollege(client, { collegeId, name, subdomain, createdBy }) {
  const result = await client.query(
    `INSERT INTO colleges (college_id, name, subdomain, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, college_id, name, subdomain, subscription_status, created_at`,
    [collegeId, name, subdomain, createdBy],
  );
  return result.rows[0];
}

module.exports = { getPlatformAdminByUsername, createCollege };
