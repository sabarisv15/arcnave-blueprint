'use strict';

async function create(client, { collegeId, name, createdByUserId }) {
  const result = await client.query(
    `INSERT INTO background_jobs (college_id, name, status, created_by_user_id)
     VALUES ($1, $2, 'queued', $3)
     RETURNING *`,
    [collegeId, name, createdByUserId],
  );
  return result.rows[0];
}

async function markRunning(client, id) {
  const result = await client.query(
    `UPDATE background_jobs
     SET status = 'running', started_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function markCompleted(client, id) {
  const result = await client.query(
    `UPDATE background_jobs
     SET status = 'completed', finished_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function markFailed(client, id, error) {
  const result = await client.query(
    `UPDATE background_jobs
     SET status = 'failed', error = $2, finished_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, error],
  );
  return result.rows[0] || null;
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM background_jobs WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM background_jobs
     ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  markRunning,
  markCompleted,
  markFailed,
  findById,
  list,
};
