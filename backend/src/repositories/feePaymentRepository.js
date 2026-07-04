'use strict';

// Query mechanics for `fee_payments` only — no business logic (that's
// a future FinanceService slice's job, not built here — see
// .ai/TASK.md). Tenant scoping for id-keyed lookups relies on the
// table's RLS policy (current_setting('app.current_tenant', true) —
// see the Module 5 fee_payments migration), same as
// financeRepository.js's findById. Never calls financeRepository,
// studentRepository, or any other repository (CLAUDE.md rule 4) —
// every function here returns this table's own rows only, no joins.
//
// Every read here filters deleted_at IS NULL — this table is
// soft-delete only (see the migration's file-level comment), same
// treatment attendanceRepository.js/financeRepository.js give their
// own tables. There is no `remove`: this repository offers no
// hard-delete function at all — BusinessRules.md's AI section names
// "fees" explicitly for soft-delete-only, and the table's own GRANT
// already omits DELETE at the DB permission level; softDelete is the
// only removal path, structurally, not just by convention.
//
// findByStudentAndFeeStructure is the "does this student already have
// a mark for this fee line" lookup the unique index enforces — mirrors
// financeRepository.js's findByCollegeClassYearCategory filtering on
// the same non-globally-unique key its own constraint uses.
// findByStudentId is the natural "every fee mark for this student"
// lookup a student profile screen needs, mirroring
// financeRepository.js's findByClassAndYear. Neither has an explicit
// college_id filter beyond RLS, matching the same reasoning
// attendance_sessions's own repository functions give: student_id and
// fee_structure_id are both real FKs into already tenant-scoped
// tables, so there's no second tenant's row an explicit filter would
// need to exclude that RLS doesn't already exclude.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['studentId', 'student_id'],
  ['feeStructureId', 'fee_structure_id'],
  ['status', 'status'],
  ['markedByUserId', 'marked_by_user_id'],
  ['receiptDocumentId', 'receipt_document_id'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // status defaults to 'not_paid'), not receive an explicit NULL,
  // which would violate its NOT NULL constraint. Same
  // entries-filtering approach as update() below and
  // financeRepository.create/attendanceRepository.create.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO fee_payments (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM fee_payments WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] || null;
}

async function findByStudentAndFeeStructure(client, studentId, feeStructureId) {
  const result = await client.query(
    `SELECT * FROM fee_payments
     WHERE student_id = $1 AND fee_structure_id = $2 AND deleted_at IS NULL`,
    [studentId, feeStructureId],
  );
  return result.rows[0] || null;
}

async function findByStudentId(client, studentId) {
  const result = await client.query(
    `SELECT * FROM fee_payments
     WHERE student_id = $1 AND deleted_at IS NULL
     ORDER BY created_at`,
    [studentId],
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
    `UPDATE fee_payments SET ${setClauses.join(', ')}, updated_at = now()
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
    `UPDATE fee_payments SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM fee_payments
     WHERE deleted_at IS NULL
     ORDER BY created_at LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByStudentAndFeeStructure,
  findByStudentId,
  update,
  softDelete,
  list,
};
