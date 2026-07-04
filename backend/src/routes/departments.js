'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/rbac');
const collegeProfileService = require('../services/collegeProfileService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// college_admin only, both read and write — same "this whole resource
// belongs to one role" reasoning routes/collegeProfile.js documents.
const DEPARTMENT_BODY_FIELDS = [
  ['name', 'name'],
  ['approved_intake', 'approvedIntake'],
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

function mapDepartmentError(err, res) {
  if (err instanceof collegeProfileService.DepartmentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof collegeProfileService.DepartmentNameConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

function createDepartmentsRouter() {
  const router = express.Router();

  router.get('/departments', requireRole('college_admin'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const departments = await collegeProfileService.listDepartments(req.dbClient, req.collegeId);
    res.json(departments);
  }));

  router.post('/departments', requireRole('college_admin'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const department = await collegeProfileService.createDepartment(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToFields(req.body || {}, DEPARTMENT_BODY_FIELDS) },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(department);
    } catch (err) {
      if (mapDepartmentError(err, res)) return;
      throw err;
    }
  }));

  router.get('/departments/:id', requireRole('college_admin'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const department = await collegeProfileService.getDepartment(req.dbClient, req.params.id);
    if (department === null) {
      res.status(404).json({ detail: `No department found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(department);
  }));

  router.put('/departments/:id', requireRole('college_admin'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const department = await collegeProfileService.updateDepartment(
        req.dbClient,
        req.params.id,
        bodyToFields(req.body || {}, DEPARTMENT_BODY_FIELDS),
        { actorUserId: req.jwtClaims.sub },
      );
      if (department === null) {
        res.status(404).json({ detail: `No department found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(department);
    } catch (err) {
      if (mapDepartmentError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/departments/:id', requireRole('college_admin'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const department = await collegeProfileService.removeDepartment(
      req.dbClient,
      req.params.id,
      { actorUserId: req.jwtClaims.sub, collegeId: req.collegeId },
    );
    if (department === null) {
      res.status(404).json({ detail: `No department found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createDepartmentsRouter;
