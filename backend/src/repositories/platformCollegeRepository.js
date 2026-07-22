'use strict';

// Query mechanics for reading `colleges` (joined with the Phase B
// rollup table `platform_college_stats`) for the Platform Admin
// Organizations screen. Platform Admin module build, Phase C
// (plans/tingly-marinating-whistle.md). Write-side (createCollege)
// stays in platformRepository.js, unchanged — this file only adds the
// list/search read path platformRepository.js never needed before.
//
// The entity/table stays `colleges` here and throughout the backend —
// "Organizations" is frontend UI copy only, not a rename of the
// underlying model.

async function listColleges(pool, { limit = 20, offset = 0, search } = {}) {
  const params = [limit, offset];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = 'WHERE c.name ILIKE $3 OR c.college_id ILIKE $3';
  }

  const result = await pool.query(
    `SELECT
       c.college_id, c.name, c.subdomain, c.subscription_status, c.created_at,
       c.level1_position_title, c.level3_position_title, c.storage_tier,
       s.active_users_count, s.students_count, s.staff_count,
       s.background_jobs_ok, s.last_sync_status, s.last_sync_error, s.updated_at AS stats_updated_at
     FROM colleges c
     LEFT JOIN platform_college_stats s ON s.college_id = c.college_id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );
  return result.rows;
}

// Dashboard summary building blocks (Phase C) — small, focused counts
// rather than folding into one large query, so each stays readable and
// independently testable.
async function countColleges(pool) {
  const result = await pool.query('SELECT count(*)::int AS count FROM colleges');
  return result.rows[0].count;
}

async function countTrialColleges(pool) {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM colleges WHERE subscription_status = 'trial'",
  );
  return result.rows[0].count;
}

async function recentColleges(pool, { limit = 5 } = {}) {
  const result = await pool.query(
    `SELECT college_id, name, subdomain, subscription_status, created_at
     FROM colleges ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

module.exports = {
  listColleges, countColleges, countTrialColleges, recentColleges,
};
