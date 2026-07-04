'use strict';

// Query mechanics for `documents` only — no business logic (that's
// DocumentService's job, not built in this slice — see .ai/TASK.md).
// Tenant scoping for id-keyed lookups relies on the table's RLS policy
// (current_setting('app.current_tenant', true) — see the Module 6
// migration), same as financeRepository.js's findById.
//
// Every read here filters deleted_at IS NULL — this table is
// soft-delete only (see the migration's file-level comment). There is
// no `remove`: this repository offers no hard-delete function at all
// — the table's own GRANT already omits DELETE at the DB permission
// level; softDelete is the only removal path, structurally, not just
// by convention.
//
// findLatestByStudentAndType resolves "the current version of this
// document type for this student" without a UNIQUE constraint forcing
// one row per type — re-uploads are new rows (versions), per
// Architecture.md 2.5's "versioning" responsibility (see the
// migration comment). findByStudentId is the natural "every document
// this student has" listing, mirroring feePaymentRepository-style
// per-owner lookups elsewhere in this codebase.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['studentId', 'student_id'],
  ['docType', 'doc_type'],
  ['fileName', 'file_name'],
  ['storagePath', 'storage_path'],
  ['mimeType', 'mime_type'],
  ['fileSizeBytes', 'file_size_bytes'],
  ['status', 'status'],
  ['uploadedByUserId', 'uploaded_by_user_id'],
  ['verifiedByUserId', 'verified_by_user_id'],
  ['verifiedAt', 'verified_at'],
  ['remarks', 'remarks'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // status defaults to 'uploaded'), not receive an explicit NULL,
  // which would violate its NOT NULL constraint. Same entries-
  // filtering approach as update() below and financeRepository.create.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO documents (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] || null;
}

async function findByStudentId(client, studentId) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE student_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [studentId],
  );
  return result.rows;
}

async function findLatestByStudentAndType(client, studentId, docType) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE student_id = $1 AND doc_type = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [studentId, docType],
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
    `UPDATE documents SET ${setClauses.join(', ')}, updated_at = now()
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
    `UPDATE documents SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE deleted_at IS NULL
     ORDER BY created_at LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByStudentId,
  findLatestByStudentAndType,
  update,
  softDelete,
  list,
};
