'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const collegeProfileService = require('../services/collegeProfileService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// college_admin only, both read and write — BusinessRules.md's College
// Admin resolution, item 3: maintaining the college's own profile is
// this role's own ongoing operational duty, not a Principal capability
// extended here. No requireAuth-for-reads/requireRole-for-writes split
// like finance.js/staff.js's placeholder: this whole resource is
// college_admin's, full stop.
const COLLEGE_PROFILE_BODY_FIELDS = [
  ['affiliating_university', 'affiliatingUniversity'],
  ['year_established', 'yearEstablished'],
  ['address', 'address'],
];

function bodyToFields(body, fieldMap) {
  const fields = {};
  for (const [snakeKey, camelKey] of fieldMap) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

function createCollegeProfileRouter() {
  const router = express.Router();

  router.get('/college-profile', requirePermission('college_profile.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const profile = await collegeProfileService.getProfile(req.dbClient, req.collegeId);
    if (profile === null) {
      res.status(404).json({ detail: `No college found with college_id ${JSON.stringify(req.collegeId)}` });
      return;
    }
    res.json(profile);
  }));

  router.put('/college-profile', requirePermission('college_profile.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const profile = await collegeProfileService.updateProfile(
      req.dbClient,
      req.collegeId,
      bodyToFields(req.body || {}, COLLEGE_PROFILE_BODY_FIELDS),
      { actorUserId: req.jwtClaims.sub },
    );
    if (profile === null) {
      res.status(404).json({ detail: `No college found with college_id ${JSON.stringify(req.collegeId)}` });
      return;
    }
    res.json(profile);
  }));

  return router;
}

module.exports = createCollegeProfileRouter;
