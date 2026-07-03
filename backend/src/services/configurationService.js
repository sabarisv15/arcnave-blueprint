'use strict';

// Business logic for the generic JSONB configuration store
// (`configurations` table) — the mechanism only, not any category's
// shape. Architecture.md eventually hangs attendance rules, fee
// structure, SMTP/SMS, AI provider config, approval policies,
// branding, and templates off this table, but those categories belong
// to whichever module owns them (Attendance, Finance, Notifications,
// AI, ...), none of which exist yet. This service never validates a
// category's internal JSON shape or maintains a list of known
// category names — same restraint as deferring the AI Tool Registry's
// shape to Module 9 rather than guessing it now.
//
// Checked the deleted Python version (git history) before writing any
// of this, rather than inventing semantics: an unset category is a
// clean 404 at the route layer, never a default empty object or
// category-specific default; the version column implements genuine
// optimistic concurrency (the caller must pass the version they last
// read, 409 on any mismatch), never a blind increment-on-every-write;
// writes are gated to `principal` only, a conservative default the
// Python version's own comment already flagged as not a settled
// decision (see routes/configurations.js).

const configurationRepository = require('../repositories/configurationRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

// Optimistic-concurrency conflict — never a silent overwrite. Covers
// three cases the caller doesn't need to distinguish: writing with a
// stale expectedVersion, writing with a non-null/non-zero
// expectedVersion against a category that doesn't exist yet, and the
// genuine race where two callers both see "doesn't exist" and both
// try to create it.
class ConfigurationVersionConflictError extends Error {}

// null means the category has simply never been configured for this
// tenant — not an error. The route turns that into 404.
async function getConfiguration(client, { collegeId, category }) {
  return configurationRepository.getConfiguration(client, { collegeId, category });
}

async function setConfiguration(client, { collegeId, category, configuration, expectedVersion, userId }) {
  // A pre-read, same as the Python version's — not what actually
  // enforces the concurrency (upsertConfiguration's own WHERE clause
  // does that atomically regardless of what happens here), but needed
  // for two things: rejecting a nonsensical expectedVersion against a
  // category that doesn't exist yet with a clear, specific error
  // (rather than silently creating it and ignoring what the caller
  // claimed to expect), and giving the audit log a real oldVersion.
  const existing = await configurationRepository.getConfiguration(client, { collegeId, category });

  if (existing === null && expectedVersion !== null && expectedVersion !== 0) {
    throw new ConfigurationVersionConflictError(
      `category ${JSON.stringify(category)} does not exist yet; expectedVersion must be null or 0`,
    );
  }

  const row = await configurationRepository.upsertConfiguration(client, {
    collegeId,
    category,
    configuration,
    expectedVersion: existing === null ? null : expectedVersion,
  });

  if (row === null) {
    throw new ConfigurationVersionConflictError(
      existing === null
        ? `category ${JSON.stringify(category)} was created concurrently`
        : `category ${JSON.stringify(category)} is at version ${existing.version}, not ${expectedVersion}`,
    );
  }

  const oldVersion = existing === null ? null : existing.version;

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'configuration_updated',
    entity: 'configurations',
    entityId: category,
    metadata: { old_version: oldVersion, new_version: row.version },
  });

  return row;
}

module.exports = { ConfigurationVersionConflictError, getConfiguration, setConfiguration };
