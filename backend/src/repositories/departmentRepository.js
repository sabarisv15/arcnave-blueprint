'use strict';

// Query mechanics for `departments` only -- no business logic (that's
// a future service's job, not built in this slice). Tenant scoping
// for id-keyed lookups relies on the table's RLS policy
// (current_setting('app.current_tenant', true) -- see the migration),
// same as staffRepository.js's findById.
//
// findByCollege/findByCollegeAndName filter on college_id explicitly
// in addition to RLS, same convention as staffRepository.js's
// findByStaffCode: college_id isn't the only column in the row's key
// (UNIQUE (college_id, name)), so the explicit filter documents the
// real key rather than relying on RLS alone.
//
// `remove` is a hard DELETE, not a soft-delete: no soft-delete column
// (deleted_at/is_active) exists on this table, same open question
// already flagged for staff/students -- not decided here either.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['name', 'name'],
  ['approvedIntake', 'approved_intake'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO departments (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM departments WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByCollege(client, collegeId) {
  const result = await client.query(
    'SELECT * FROM departments WHERE college_id = $1 ORDER BY name',
    [collegeId],
  );
  return result.rows;
}

async function findByCollegeAndName(client, collegeId, name) {
  const result = await client.query(
    'SELECT * FROM departments WHERE college_id = $1 AND name = $2',
    [collegeId, name],
  );
  return result.rows[0] || null;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE departments SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM departments WHERE id = $1', [id]);
}

module.exports = {
  create,
  findById,
  findByCollege,
  findByCollegeAndName,
  update,
  remove,
};
