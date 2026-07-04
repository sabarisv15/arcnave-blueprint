'use strict';

// Query mechanics for `fee_structures` only — no business logic
// (that's FinanceService's job, not built in this slice — see
// .ai/TASK.md). Tenant scoping for id-keyed lookups relies on the
// table's RLS policy (current_setting('app.current_tenant', true) —
// see the Module 5 migration), same as classRepository.js's findById
// and attendanceRepository.js's findById.
//
// Every read here filters deleted_at IS NULL — this table is
// soft-delete only (see the migration's file-level comment), same
// treatment attendanceRepository.js gives attendance_sessions. There
// is no `remove`: this repository offers no hard-delete function at
// all — BusinessRules.md's AI section names "fees" explicitly
// alongside attendance for soft-delete-only, and the table's own
// GRANT already omits DELETE at the DB permission level; softDelete
// is the only removal path, structurally, not just by convention.
//
// findByCollegeClassYearCategory is the "does this exact fee line
// already exist" lookup the unique index enforces — mirrors
// classRepository.js's findByCollegeAndClassName filtering on the
// same non-globally-unique key its own constraint uses.
// findByClassAndYear is the natural "every fee line for this class in
// this academic year" lookup, mirroring attendanceRepository.js's
// findByClassAndDate. Both filter college_id implicitly via RLS only
// (no explicit college_id parameter) for the same reason
// attendanceRepository.js's own functions give: class_id is already a
// real classes.id UUID, globally unique, so there's no second
// tenant's row an explicit filter would need to exclude that RLS
// doesn't already exclude.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['academicYear', 'academic_year'],
  ['classId', 'class_id'],
  ['feeCategory', 'fee_category'],
  ['amount', 'amount'],
  ['status', 'status'],
  ['remarks', 'remarks'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // status defaults to 'Pending Approval'), not receive an explicit
  // NULL, which would violate its NOT NULL constraint. Same
  // entries-filtering approach as update() below and
  // classRepository.create/attendanceRepository.create.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO fee_structures (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM fee_structures WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] || null;
}

async function findByCollegeClassYearCategory(client, collegeId, classId, academicYear, feeCategory) {
  const result = await client.query(
    `SELECT * FROM fee_structures
     WHERE college_id = $1 AND class_id = $2 AND academic_year = $3 AND fee_category = $4
       AND deleted_at IS NULL`,
    [collegeId, classId, academicYear, feeCategory],
  );
  return result.rows[0] || null;
}

async function findByClassAndYear(client, classId, academicYear) {
  const result = await client.query(
    `SELECT * FROM fee_structures
     WHERE class_id = $1 AND academic_year = $2 AND deleted_at IS NULL
     ORDER BY fee_category`,
    [classId, academicYear],
  );
  return result.rows;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE fee_structures SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

// Sets deleted_at rather than issuing a DELETE — see the file-level
// comment. Idempotent against an already-deleted or missing id: the
// WHERE guard means a second call simply matches no row.
async function softDelete(client, id) {
  const result = await client.query(
    `UPDATE fee_structures SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM fee_structures
     WHERE deleted_at IS NULL
     ORDER BY created_at LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByCollegeClassYearCategory,
  findByClassAndYear,
  update,
  softDelete,
  list,
};
