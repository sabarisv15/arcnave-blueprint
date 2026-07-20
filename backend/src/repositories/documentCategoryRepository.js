'use strict';

// Query mechanics for `document_categories` only — no business logic
// (that's documentCategoryService's job), same split every other
// repository in this codebase already draws. Tenant scoping relies on
// the table's RLS policy (current_setting('app.current_tenant', true)),
// same as documentRepository — no explicit college_id filter needed
// here.

async function create(client, { collegeId, name, slug }) {
  const result = await client.query(
    `INSERT INTO document_categories (college_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [collegeId, name, slug],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM document_categories WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

async function list(client) {
  const result = await client.query(
    'SELECT * FROM document_categories ORDER BY name',
  );
  return result.rows;
}

// Exact-name lookup — same convention departmentRepository.findByCollegeAndName/
// academicYearRepository.findByCollegeAndYearLabel already use for AI
// identifier resolution (resolveClassId's own sibling functions).
async function findByCollegeAndName(client, collegeId, name) {
  const result = await client.query(
    'SELECT * FROM document_categories WHERE college_id = $1 AND name = $2',
    [collegeId, name],
  );
  return result.rows[0] || null;
}

module.exports = {
  create, findById, list, findByCollegeAndName,
};
