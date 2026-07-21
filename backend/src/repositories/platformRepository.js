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

// The first-run bootstrap this session's own task asks for: creates
// the very first platform_admins row, but ONLY if none exists yet —
// expressed as a single atomic statement (INSERT ... SELECT ... WHERE
// NOT EXISTS), not a check-then-insert, so a race between two
// concurrent bootstrap calls can never both succeed. RETURNING zero
// rows (an empty result, not an error) means a platform admin already
// exists; the service layer maps that to a real, typed error.
async function bootstrapPlatformAdmin(client, { username, email, passwordHash }) {
  const result = await client.query(
    `INSERT INTO platform_admins (username, email, password_hash)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM platform_admins)
     RETURNING id, username, email, created_at`,
    [username, email, passwordHash],
  );
  return result.rows[0] || null;
}

async function createCollege(client, {
  collegeId, name, subdomain, createdBy, level1PositionTitle,
}) {
  const result = await client.query(
    `INSERT INTO colleges (college_id, name, subdomain, created_by, level1_position_title)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, college_id, name, subdomain, subscription_status, created_at, level1_position_title`,
    [collegeId, name, subdomain, createdBy, level1PositionTitle || null],
  );
  return result.rows[0];
}

// Platform Admin module build, Phase B (plans/tingly-marinating-
// whistle.md) — the scheduler (jobs/platformStatsSync.js) needs the
// full set of college_ids to iterate for the tenant stats rollup.
// Plain id list, no pagination: colleges are platform-admin-created
// one at a time, nowhere near the row count that would need it.
async function listCollegeIds(client) {
  const result = await client.query('SELECT college_id FROM colleges ORDER BY college_id');
  return result.rows.map((row) => row.college_id);
}

module.exports = {
  getPlatformAdminByUsername, bootstrapPlatformAdmin, createCollege, listCollegeIds,
};
