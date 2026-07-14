'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const academicService = require('../services/academicService');
const staffService = require('../services/staffService');
const workflowService = require('../services/workflowService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as staff.js's STAFF_BODY_FIELDS. college_id is
// deliberately absent (always req.collegeId, never the request body).
// tutor_user_id IS mapped here, same reasoning staff.js gives for
// user_id: it's how the caller names which already-provisioned
// account a class's tutor duty is being assigned to (classes.tutor_user_id
// is FK'd to users.id, nullable — a class can also be created with no
// tutor at all).
const CLASS_BODY_FIELDS = [
  ['class_name', 'className'],
  ['department', 'department'],
  ['department_id', 'departmentId'],
  ['semester', 'semester'],
  ['tutor_user_id', 'tutorUserId'],
  ['timetable_status', 'timetableStatus'],
  ['timetable_data', 'timetableData'],
  ['timetable_remarks', 'timetableRemarks'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of CLASS_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// staff.js/students.js made, same reasoning: strictly less code here,
// and nothing downstream expects camelCase yet.

function mapAcademicServiceError(err, res) {
  if (err instanceof academicService.ClassValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTimetableStatusError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassNameConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTutorConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTutorNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassDepartmentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTimetableStatusManagedByWorkflowError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassTimetableApprovalNotPendingError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffHodNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffPrincipalNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestUserNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof workflowService.WorkflowRequestValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassSendAlertValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.ClassSendAlertNotTutorError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function createClassesRouter() {
  const router = express.Router();

  // RBAC here is the same deliberately conservative default
  // staff.js/students.js use, not a final decision. BusinessRules.md's
  // real rules ("Class Tutor is assigned only by HOD", the HOD/
  // Principal timetable review chain) go through the real
  // submitTimetableForApproval/approveTimetableApproval chain now
  // (WorkflowService, Module 8) for the review itself, but plain
  // create/update/delete on a class row is still gated by
  // requirePermission('classes.create'/'update'/'delete') — mapped to
  // ['principal'] in middleware/permissions.js — since Principal is
  // the one existing role that's genuinely the final authority in
  // every real chain BusinessRules.md describes; requireAuth gates
  // reads. Revisit once BusinessRules.md names a narrower actor (e.g.
  // "HOD may assign a Class Tutor for their own department") — that's
  // a new permission mapping at that point, not a new mechanism.

  router.post('/classes', requirePermission('classes.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const cls = await academicService.createClass(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToServiceFields(req.body || {}) },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(cls);
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/classes/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const cls = await academicService.getClass(req.dbClient, req.params.id);
    if (cls === null) {
      res.status(404).json({ detail: `No class found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(cls);
  }));

  // limit/offset are passed through as-is — academicService/
  // classRepository already default them to 50/0, not re-implemented
  // here.
  router.get('/classes', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit: rawLimit, offset: rawOffset } = req.query;
    const classes = await academicService.listClasses(req.dbClient, {
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
      offset: rawOffset === undefined ? undefined : Number(rawOffset),
    });
    res.json(classes);
  }));

  router.put('/classes/:id', requirePermission('classes.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const cls = await academicService.updateClass(
        req.dbClient,
        req.params.id,
        bodyToServiceFields(req.body || {}),
        { userId: req.jwtClaims.sub },
      );
      if (cls === null) {
        res.status(404).json({ detail: `No class found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(cls);
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  // Module 3->4 gap fix: the trigger point for the real HOD->Principal
  // timetable review chain — same requireAuth (not requireRole)
  // reasoning staff.js's own submit-registration route gives: the
  // named actor per BusinessRules.md is whoever submits, and
  // workflowService's own step-matching + self-approval checks are the
  // real gate, not this route's RBAC.
  router.post('/classes/:id/submit-for-approval', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const workflowRequest = await academicService.submitTimetableForApproval(
        req.dbClient,
        req.params.id,
        { requestedByUserId: req.jwtClaims.sub },
      );
      res.status(201).json(workflowRequest);
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  // Send Alert (item 5 of this session's task) — requireAuth, not a
  // permission: the real gate is academicService.sendClassAlert's own
  // "actorUserId must equal this class's tutor_user_id" check, same
  // requireAuth-not-requireRole reasoning submit-for-approval above
  // already documents for an actor-scoped action. Body is a single
  // plain-text field, no AI, never routed through WorkflowService — see
  // sendClassAlert's own comment for why that's an explicitly
  // documented exception, not an oversight.
  router.post('/classes/:id/send-alert', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const results = await academicService.sendClassAlert(
        req.dbClient,
        req.params.id,
        (req.body || {}).body,
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(200).json({ results });
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/classes/:id', requirePermission('classes.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const cls = await academicService.removeClass(req.dbClient, req.params.id, { userId: req.jwtClaims.sub });
    if (cls === null) {
      res.status(404).json({ detail: `No class found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createClassesRouter;
