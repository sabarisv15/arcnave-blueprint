'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const configurationService = require('../services/configurationService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// Sensitive categories (this session's own task) — finance, notifications
// and their provider config, AI provider config, approval/workflow
// policy, and per-provider vendor secrets are all Confidential-or-worse
// data (AI-Governance.md §4's own table names finance/parent-contact
// data at that level; the various provider categories hold — even if
// encrypted at rest, per notificationChannelRepository/cryptoUtil —
// vendor account identifiers no ordinary staff member has a reason to
// read). Restricted to principal/college_admin, not left to "any
// authenticated tenant user" the way a category like attendance-rule
// display config still reasonably is. A static list, same reasoning
// middleware/permissions.js's own PERMISSION_ROLES table gives for
// being a static, code-level config rather than a DB table — nothing
// names a need for per-tenant customization of which categories count
// as sensitive.
const SENSITIVE_CONFIGURATION_CATEGORIES = [
  'finance',
  'notifications',
  'notification_channels',
  'ai',
  'ai_config',
  'approval',
  'workflow',
  'smtp',
  'sms',
  'whatsapp',
  'providers',
];

function createConfigurationsRouter() {
  const router = express.Router();

  // Any authenticated tenant user may read a non-sensitive category —
  // matches the Python version's require_role(*TENANT_ROLES). A
  // sensitive category (SENSITIVE_CONFIGURATION_CATEGORIES above) is
  // restricted to principal/college_admin instead (this session's own
  // task: this route used to let any authenticated user read finance/
  // notification-provider/AI-provider config, credentials included).
  router.get('/configurations/:category', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    if (SENSITIVE_CONFIGURATION_CATEGORIES.includes(req.params.category)
      && !['principal', 'college_admin'].includes(req.jwtClaims.role)) {
      res.status(403).json({ detail: `role ${JSON.stringify(req.jwtClaims.role)} may not read configuration category ${JSON.stringify(req.params.category)}` });
      return;
    }
    const row = await configurationService.getConfiguration(req.dbClient, {
      collegeId: req.collegeId,
      category: req.params.category,
    });
    if (row === null) {
      res.status(404).json({ detail: `No configuration set for category ${JSON.stringify(req.params.category)}` });
      return;
    }
    res.json({ category: row.category, configuration: row.configuration, version: row.version });
  }));

  // Checked the deleted Python version rather than guessing: writes
  // were gated to require_role("principal") specifically — a
  // hardcoded single role, not the open tenant-role-model question
  // RBAC's own build already flagged as unresolved (BusinessRules.md
  // still doesn't say who should be able to change configuration;
  // that's decided per-category by whichever module owns it — e.g.
  // fee-structure changes might reasonably need HOD, not just
  // principal). Ported as-is, conservative default and all, not
  // silently resolved or silently loosened — worth revisiting once a
  // real category has a real business rule about who can change it.
  router.put('/configurations/:category', requirePermission('configurations.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { configuration, expected_version: rawExpectedVersion } = req.body || {};
    const expectedVersion = rawExpectedVersion === undefined ? null : rawExpectedVersion;
    try {
      const row = await configurationService.setConfiguration(req.dbClient, {
        collegeId: req.collegeId,
        category: req.params.category,
        configuration,
        expectedVersion,
        userId: req.jwtClaims.sub,
      });
      res.json({ category: row.category, configuration: row.configuration, version: row.version });
    } catch (err) {
      if (err instanceof configurationService.ConfigurationVersionConflictError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  return router;
}

module.exports = createConfigurationsRouter;
