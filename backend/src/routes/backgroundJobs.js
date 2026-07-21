'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const { shadowCompare } = require('../middleware/identityShadow');
const backgroundJobService = require('../services/backgroundJobService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function createBackgroundJobsRouter() {
  const router = express.Router();

  router.post('/background-jobs', requirePermission('background_jobs.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const body = req.body || {};
    const job = await backgroundJobService.enqueue(req.dbClient, {
      collegeId: req.collegeId,
      name: body.name || 'manual_job',
      createdByUserId: req.jwtClaims.sub,
    });
    res.status(202).json(job);
  }));

  // Identity-Migration-Plan.md Phase 3 — enrolled in shadow-mode
  // comparison (the list route only, not the by-id lookup, to keep
  // this phase's blast radius small — see middleware/identityShadow.js).
  router.get('/background-jobs', requirePermission('background_jobs.read'), shadowCompare('background_jobs.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    res.json(await backgroundJobService.list(req.dbClient));
  }));

  router.get('/background-jobs/:id', requirePermission('background_jobs.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const job = await backgroundJobService.find(req.dbClient, req.params.id);
    if (!job) {
      res.status(404).json({ detail: 'Background job not found' });
      return;
    }
    res.json(job);
  }));

  return router;
}

module.exports = createBackgroundJobsRouter;
