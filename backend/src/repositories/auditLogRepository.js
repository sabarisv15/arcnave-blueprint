'use strict';

// Query mechanics for `audit_log` only — no business logic. A tiny,
// separate file rather than bundled into whichever service first
// needed it (configurationService.js): audit_log is a cross-cutting,
// append-only table every future service will eventually write to,
// not something that belongs conceptually to configuration.
// arcnave_app has SELECT/INSERT only on this table (no UPDATE/DELETE,
// by design — see the ported migration) — an audit trail the app
// role can rewrite or erase isn't an audit trail, so
// createAuditLogEntry is the only write this file offers.

async function createAuditLogEntry(client, { collegeId, userId, action, entity, entityId, metadata }) {
  await client.query(
    `INSERT INTO audit_log (college_id, user_id, action, entity, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [collegeId, userId, action, entity, entityId, JSON.stringify(metadata)],
  );
}

module.exports = { createAuditLogEntry };
