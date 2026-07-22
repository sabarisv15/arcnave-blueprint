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

const COLLEGE_RETURNING = `id, college_id, name, subdomain, subscription_status, created_at,
     level1_position_title, level3_position_title, storage_tier`;

async function createCollege(client, {
  collegeId, name, subdomain, createdBy, level1PositionTitle, level3PositionTitle, storageTier, subscriptionStatus,
}) {
  const result = await client.query(
    `INSERT INTO colleges (college_id, name, subdomain, created_by, level1_position_title,
       level3_position_title, storage_tier, subscription_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLLEGE_RETURNING}`,
    [collegeId, name, subdomain, createdBy, level1PositionTitle || null,
      level3PositionTitle || null, storageTier || null, subscriptionStatus || 'trial'],
  );
  return result.rows[0];
}

async function findCollegeById(client, collegeId) {
  const result = await client.query(
    `SELECT ${COLLEGE_RETURNING} FROM colleges WHERE college_id = $1`,
    [collegeId],
  );
  return result.rows[0] || null;
}

// Create/Edit College customization — the edit half of createCollege
// above. college_id/subdomain/created_by are deliberately not
// editable here: college_id is this table's own external identifier
// (other tables FK to it, tenant resolution keys off it) and subdomain
// is what a college's users already have bookmarked/configured DNS
// against — neither is safe to change through a simple PATCH, so
// neither is even accepted as a field name below. name/license
// (subscription_status)/level1_position_title/level3_position_title/
// storage_tier are all cosmetic-or-administrative facts a Platform
// Admin may legitimately revise after creation.
const EDITABLE_COLUMNS = [
  ['name', 'name'],
  ['subscriptionStatus', 'subscription_status'],
  ['level1PositionTitle', 'level1_position_title'],
  ['level3PositionTitle', 'level3_position_title'],
  ['storageTier', 'storage_tier'],
];

async function updateCollege(client, collegeId, fields) {
  const entries = EDITABLE_COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findCollegeById(client, collegeId);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE colleges SET ${setClauses.join(', ')}
     WHERE college_id = $1
     RETURNING ${COLLEGE_RETURNING}`,
    [collegeId, ...values],
  );
  return result.rows[0] || null;
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
  getPlatformAdminByUsername, bootstrapPlatformAdmin, createCollege, findCollegeById, updateCollege, listCollegeIds,
};
