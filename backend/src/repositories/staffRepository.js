'use strict';

// Query mechanics for `staff` only — no business logic (that's
// StaffService's job, not built in this slice — see .ai/TASK.md).
// Tenant scoping for id-keyed lookups relies on the table's RLS
// policy (current_setting('app.current_tenant', true) — see the
// Module 2 migration), same as studentRepository.js's findById.
//
// findByUserId has no explicit college_id filter beyond RLS: user_id
// is globally unique (UNIQUE (user_id), FK to users(id)), unlike
// roll_no/staff_code which are only unique per (college_id, ...) —
// there is no second tenant that could share a user_id to disambiguate
// against, so an explicit filter would be redundant, not defense in
// depth.
//
// findByStaffCode filters on college_id explicitly in addition to
// RLS, same as studentRepository.js's findByRollNo, because
// staff_code's uniqueness is scoped to (college_id, staff_code), not
// global — RLS alone would still return the right row, but the
// explicit filter documents the real key and matches house
// convention for non-globally-unique lookups.
//
// `remove` is a hard DELETE, not a soft-delete: the ERD in .ai/TASK.md
// has no soft-delete column (no deleted_at/is_active) for staff yet —
// same open question flagged for students, not decided here either.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['userId', 'user_id'],
  ['staffCode', 'staff_code'],
  ['fullName', 'full_name'],
  ['gender', 'gender'],
  ['dob', 'dob'],
  ['phone', 'phone'],
  ['department', 'department'],
  ['designation', 'designation'],
  ['qualification', 'qualification'],
  ['hasPhd', 'has_phd'],
  ['aicteId', 'aicte_id'],
  ['joinedYear', 'joined_year'],
  ['address', 'address'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // has_phd defaults to false), not receive an explicit NULL, which
  // would violate its NOT NULL constraint. Same entries-filtering
  // approach as update() below and studentRepository.create.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO staff (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM staff WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByUserId(client, userId) {
  const result = await client.query('SELECT * FROM staff WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function findByStaffCode(client, collegeId, staffCode) {
  const result = await client.query(
    'SELECT * FROM staff WHERE college_id = $1 AND staff_code = $2',
    [collegeId, staffCode],
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
    `UPDATE staff SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM staff WHERE id = $1', [id]);
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM staff ORDER BY created_at LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

module.exports = { create, findById, findByUserId, findByStaffCode, update, remove, list };
