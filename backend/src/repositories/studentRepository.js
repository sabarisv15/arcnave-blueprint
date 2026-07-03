'use strict';

// Query mechanics for `students` only — no business logic (that's
// StudentService's job, not built in this slice — see .ai/TASK.md).
// Tenant scoping for id-keyed lookups relies on the table's RLS
// policy (current_setting('app.current_tenant', true) — see the
// Module 1 migration), same as authRepository.js's getUserById.
// findByRollNo filters on college_id explicitly in addition to RLS,
// same as authRepository.js's getUserByUsername, because roll_no's
// uniqueness is scoped to (college_id, roll_no), not global — RLS
// alone would still return the right row, but the explicit filter
// documents the real key and matches house convention for
// non-globally-unique lookups.
//
// `remove` is a hard DELETE, not a soft-delete: the ERD in .ai/TASK.md
// has no soft-delete column (no deleted_at/is_active) for students
// yet. Flagged as an open question there, not a decision made here.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['rollNo', 'roll_no'],
  ['fullName', 'full_name'],
  ['gender', 'gender'],
  ['entryType', 'entry_type'],
  ['emisNumber', 'emis_number'],
  ['umisNumber', 'umis_number'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['phoneVerified', 'phone_verified'],
  ['parentName', 'parent_name'],
  ['parentPhone', 'parent_phone'],
  ['parentPhoneVerified', 'parent_phone_verified'],
  ['address', 'address'],
  ['pincode', 'pincode'],
  ['mark10th', 'mark_10th'],
  ['mark12th', 'mark_12th'],
  ['markIti', 'mark_iti'],
  ['accommodation', 'accommodation'],
  ['club', 'club'],
  ['internship', 'internship'],
  ['careerPlan', 'career_plan'],
  ['notes', 'notes'],
  ['licenseNumber', 'license_number'],
  ['bikeNumber', 'bike_number'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // phone_verified/parent_phone_verified default to false), not
  // receive an explicit NULL, which would violate their NOT NULL
  // constraint. Same entries-filtering approach as update() below.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO students (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM students WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByRollNo(client, collegeId, rollNo) {
  const result = await client.query(
    'SELECT * FROM students WHERE college_id = $1 AND roll_no = $2',
    [collegeId, rollNo],
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
    `UPDATE students SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  await client.query('DELETE FROM students WHERE id = $1', [id]);
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM students ORDER BY created_at LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

module.exports = { create, findById, findByRollNo, update, remove, list };
