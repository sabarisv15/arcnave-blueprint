'use strict';

// Query mechanics ONLY for identity_migration_mismatches (Identity-
// Migration-Plan.md Phase 3 / Observability's "Mismatch reporting"
// table — see the migration for the full column rationale). No
// business logic — deciding WHETHER two answers disagree, and what to
// put in each column, is middleware/identityShadow.js's job, same
// query-mechanics-only split every other *Repository.js in this
// codebase keeps. Never calls another repository (CLAUDE.md rule 4).

async function recordMismatch(client, {
  collegeId,
  userId,
  requestId,
  route,
  permissionKey,
  mismatchType,
  legacyRole,
  identityEffectiveRole,
  legacyScopeLevel,
  identityScopeLevel,
  legacyDepartmentIds,
  identityDepartmentIds,
  detail,
}) {
  const result = await client.query(
    `INSERT INTO identity_migration_mismatches (
       college_id, user_id, request_id, route, permission_key, mismatch_type,
       legacy_role, identity_effective_role, legacy_scope_level, identity_scope_level,
       legacy_department_ids, identity_department_ids, detail
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      collegeId,
      userId,
      requestId || null,
      route,
      permissionKey,
      mismatchType,
      legacyRole || null,
      identityEffectiveRole || null,
      legacyScopeLevel || null,
      identityScopeLevel || null,
      legacyDepartmentIds && legacyDepartmentIds.length ? legacyDepartmentIds : null,
      identityDepartmentIds && identityDepartmentIds.length ? identityDepartmentIds : null,
      detail || null,
    ],
  );
  return result.rows[0];
}

async function findRecentByCollege(client, collegeId, limit = 100) {
  const result = await client.query(
    `SELECT * FROM identity_migration_mismatches
     WHERE college_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [collegeId, limit],
  );
  return result.rows;
}

async function countByCollege(client, collegeId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM identity_migration_mismatches WHERE college_id = $1',
    [collegeId],
  );
  return result.rows[0].count;
}

module.exports = { recordMismatch, findRecentByCollege, countByCollege };
