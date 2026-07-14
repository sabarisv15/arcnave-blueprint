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
// Soft-delete (this session's own task): students.deleted_at, set by
// softDelete below instead of a hard DELETE. Every read/list query
// here filters `deleted_at IS NULL` by default — a soft-deleted row is
// meant to behave as if it doesn't exist for every normal query path,
// the same way RLS already makes a different tenant's row invisible.
// There is no hard-delete function left in this file at all (the old
// `remove` is gone, not just unused) — CLAUDE.md rule 8/this session's
// own constraint: no route may reach a hard-delete path.

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
  ['annualIncome', 'annual_income'],
  ['classId', 'class_id'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // phone_verified/parent_phone_verified default to false), not
  // receive an explicit NULL, which would violate their NOT NULL
  // constraint. Same entries-filtering approach as update() below.
  // deleted_at is never in COLUMNS (never caller-settable) — a newly
  // created row always has it NULL, via the column's own default.
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
  const result = await client.query('SELECT * FROM students WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] || null;
}

async function findByRollNo(client, collegeId, rollNo) {
  const result = await client.query(
    'SELECT * FROM students WHERE college_id = $1 AND roll_no = $2 AND deleted_at IS NULL',
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
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

// The "students in a class" lookup Send Alert (classService's
// sendClassAlert, item 5 of this session's task) needs — the only
// place students.class_id is read back by more than one row at a time.
async function findByClassId(client, classId) {
  const result = await client.query('SELECT * FROM students WHERE class_id = $1 AND deleted_at IS NULL', [classId]);
  return result.rows;
}

// The "students in a department" lookup studentService.listStudents
// needs to scope an hod's own reads — joins to classes since
// department_id lives there, not on students directly (same
// college_notification_channels-style join reasoning staffRepository's
// findByCollegeDepartmentAndRole already uses for its own users JOIN).
// No pagination baked in here — same "return everything, let the
// caller slice" choice findByClassId already makes, for the same
// reason (Send Alert-style full-roster callers exist for classes;
// keeping this symmetric avoids two different pagination conventions
// for what's structurally the same kind of scoped lookup).
async function findByDepartmentId(client, departmentId) {
  const result = await client.query(
    `SELECT students.* FROM students
     JOIN classes ON classes.id = students.class_id
     WHERE classes.department_id = $1 AND students.deleted_at IS NULL
     ORDER BY students.created_at`,
    [departmentId],
  );
  return result.rows;
}

// Soft-delete (this session's own task) — replaces the old hard
// DELETE. `deleted_at IS NULL` in the WHERE clause makes this a no-op
// (returns null) against an already-deleted row, same idempotent-404
// shape studentService.removeStudent already expects from a
// nonexistent id.
async function softDelete(client, id) {
  const result = await client.query(
    `UPDATE students SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM students WHERE deleted_at IS NULL ORDER BY created_at LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create, findById, findByRollNo, findByClassId, findByDepartmentId, update, softDelete, list,
};
