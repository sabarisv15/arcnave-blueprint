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

function createConfigurationsRouter() {
  const router = express.Router();

  // Any authenticated tenant user may read — matches the Python
  // version's require_role(*TENANT_ROLES). Uses requireAuth here
  // rather than spelling out every known role, same reasoning as
  // GET /auth/me: "any authenticated tenant user" isn't a role-gated
  // capability, and hardcoding the role list at this call site would
  // silently under-cover a future new role.
  router.get('/configurations/:category', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
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
