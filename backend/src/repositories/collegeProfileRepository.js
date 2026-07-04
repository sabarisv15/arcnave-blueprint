'use strict';

// Query mechanics for the College Admin's own three profile columns
// on `colleges` (affiliating_university, year_established, address)
// only -- not the whole table. Distinct from platformRepository.js,
// which owns `colleges` for the Platform layer (college creation,
// ADR-010); this file is the tenant-side counterpart, read through
// `arcnave_app`/`req.dbClient`, for a College Admin viewing/editing
// their own college's profile. No business logic here (that's a
// future collegeProfileService's job) -- no service/API/UI in this
// slice, per this pass's own build brief.
//
// `colleges` has no RLS (see the migration's own comment for why it
// structurally can't: Tenant Middleware reads it before
// app.current_tenant is ever set, to resolve the tenant in the first
// place). That means the `WHERE college_id = $1` filter below is NOT
// defense-in-depth the way an equivalent filter is on every other
// tenant table in this codebase (staffRepository.findByStaffCode,
// etc.) -- it is the *only* thing scoping which row updateProfile
// touches. The column-level GRANT (arcnave_app can UPDATE only these
// three columns, never subscription_status/subdomain/name/
// created_by/college_id) is the other half of the mitigation, enforced
// at the DB level regardless of what this file does.

const COLUMNS = [
  ['affiliatingUniversity', 'affiliating_university'],
  ['yearEstablished', 'year_established'],
  ['address', 'address'],
];

async function getByCollegeId(client, collegeId) {
  const result = await client.query(
    `SELECT college_id, name, affiliating_university, year_established, address
     FROM colleges
     WHERE college_id = $1`,
    [collegeId],
  );
  return result.rows[0] || null;
}

async function updateProfile(client, collegeId, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return getByCollegeId(client, collegeId);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE colleges SET ${setClauses.join(', ')}
     WHERE college_id = $1
     RETURNING college_id, name, affiliating_university, year_established, address`,
    [collegeId, ...values],
  );
  return result.rows[0] || null;
}

module.exports = { getByCollegeId, updateProfile };
