'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const staffService = require('../services/staffService');
const workflowService = require('../services/workflowService');
const visibilityService = require('../services/visibilityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as students.js's STUDENT_BODY_FIELDS.
// college_id is deliberately absent (always req.collegeId, never the
// request body). Unlike students.js, user_id IS mapped here: it's how
// the caller names which already-provisioned account this profile
// belongs to (staff.user_id is NOT NULL + FK'd to users.id) — students
// has no equivalent column at all.
const STAFF_BODY_FIELDS = [
  ['user_id', 'userId'],
  ['staff_code', 'staffCode'],
  ['full_name', 'fullName'],
  ['gender', 'gender'],
  ['dob', 'dob'],
  ['phone', 'phone'],
  ['department', 'department'],
  ['department_id', 'departmentId'],
  ['designation', 'designation'],
  ['qualification', 'qualification'],
  ['has_phd', 'hasPhd'],
  ['aicte_id', 'aicteId'],
  ['joined_year', 'joinedYear'],
  ['address', 'address'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of STAFF_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// students.js made, same reasoning: strictly less code here, and
// nothing downstream expects camelCase yet.

function mapStaffServiceError(err, res) {
  if (err instanceof staffService.StaffValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffUserConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffCodeConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffAccountConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffUserNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffDepartmentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffPrincipalAlreadyActiveError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffHodAlreadyActiveError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffDeactivationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.StaffDeactivationHasActiveDutiesError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.HodInChargeValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof staffService.HodInChargeAlreadyActiveError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  // submitStaffRegistration's own error surface, per its own comment:
  // resolves the department's real HOD and the college's real Principal
  // (each throws if none exists yet), then calls
  // workflowService.submitRequest (throws if a Pending request already
  // governs this staff row, or the resolved shape is somehow invalid) —
  // none of these are staffService's own CRUD error classes, but this
  // route is the one place they can actually surface.
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
  if (err instanceof visibilityService.VisibilityForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function createStaffRouter() {
  const router = express.Router();

  // RBAC here is the same deliberately conservative default
  // students.js uses, not a final decision. BusinessRules.md's real
  // Staff registration chain (Faculty submits -> HOD approves ->
  // Principal approves) now runs through the real WorkflowService
  // (Module 8, see submitStaffRegistration/approveStaffRegistration
  // below), but plain create/update/delete on a staff row is still
  // gated by requirePermission('staff.create'/'update'/'delete')
  // (mapped to ['principal'] in middleware/permissions.js) — both the
  // Staff and HOD registration chains BusinessRules.md describes end
  // with Principal's final approval, so Principal is the one existing
  // role that's genuinely the final authority in every real chain;
  // requireAuth gates reads.

  router.post('/staff', requirePermission('staff.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const staff = await staffService.createStaff(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToServiceFields(req.body || {}) },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(staff);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/staff/hod-accounts', requirePermission('staff.hod_accounts.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const { username, email } = req.body || {};
      const result = await staffService.provisionHodAccount(
        req.dbClient,
        {
          collegeId: req.collegeId,
          username,
          email,
          ...bodyToServiceFields(req.body || {}),
        },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json({
        user_id: result.user.id,
        staff_id: result.staff.id,
        college_id: result.staff.college_id,
        username: result.user.username,
        email: result.user.email,
        role: result.user.role,
        staff_code: result.staff.staff_code,
        department_id: result.staff.department_id,
      });
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth gates "must be logged in"; the real scope (self, hod of
  // the target's own department, principal college-wide — this
  // session's own task) is visibilityService.assertCanViewStaff's job.
  router.get('/staff/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    let staff;
    try {
      staff = await visibilityService.assertCanViewStaff(req.dbClient, { staffId: req.params.id }, {
        actorUserId: req.jwtClaims.sub, actorRole: req.jwtClaims.role,
      });
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
    if (staff === null) {
      res.status(404).json({ detail: `No staff found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(staff);
  }));

  // limit/offset are passed through as-is — staffService/
  // staffRepository already default them to 50/0, not re-implemented
  // here. Scoped by role (this session's own task: this route used to
  // return the whole college's staff directory to anyone
  // authenticated): principal sees the whole college, hod sees their
  // own (real, verified) department, ordinary staff see only their own
  // profile.
  router.get('/staff', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit: rawLimit, offset: rawOffset } = req.query;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    const offset = rawOffset === undefined ? 0 : Number(rawOffset);
    const actorRole = req.jwtClaims.role;
    const actorUserId = req.jwtClaims.sub;

    if (actorRole === 'principal') {
      const staff = await staffService.listStaff(req.dbClient, { limit, offset });
      res.json(staff);
      return;
    }
    if (actorRole === 'hod') {
      const departmentId = await staffService.findHodDepartmentId(req.dbClient, req.collegeId, actorUserId);
      if (departmentId === null) {
        res.json([]);
        return;
      }
      const all = await staffService.listStaffByDepartment(req.dbClient, departmentId);
      res.json(all.slice(offset, offset + limit));
      return;
    }
    const self = await staffService.getStaffByUserId(req.dbClient, actorUserId);
    res.json(self === null ? [] : [self]);
  }));

  router.put('/staff/:id', requirePermission('staff.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const staff = await staffService.updateStaff(
        req.dbClient,
        req.params.id,
        bodyToServiceFields(req.body || {}),
        { userId: req.jwtClaims.sub },
      );
      if (staff === null) {
        res.status(404).json({ detail: `No staff found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(staff);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  // Module 8 final slice: submitStaffRegistration was built (Module 8
  // first/third slices) but never wired to a route — a staff profile
  // created above has no way to actually enter the real
  // Faculty->HOD->Principal chain. This is that trigger point.
  //
  // requireAuth, deliberately NOT the principal-mapped permission gate
  // create/update above use: BusinessRules.md names a real actor for
  // this one action ("Faculty submits"), unlike create/update which
  // have no named actor and so fall back to this router's conservative
  // default. Gating submission to principal-only would actively
  // break the feature for the common single-principal-per-college
  // case — requestedByUserId would equal the Principal's own user_id,
  // which is also the resolved final-step approver in every chain
  // (findPrincipal), so ADR-005's self-approval rule would reject
  // every single submission at the terminal step. workflowService's
  // own step-matching + self-approval checks are the real gate here
  // (same "the service is the gate, not requireRole" reasoning
  // attendance.js's router comment already gives for
  // AttendanceForbiddenError), not this route's RBAC.
  router.post('/staff/:id/submit-registration', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const workflowRequest = await staffService.submitStaffRegistration(
        req.dbClient,
        req.params.id,
        { requestedByUserId: req.jwtClaims.sub },
      );
      res.status(201).json(workflowRequest);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth, not requirePermission: BusinessRules.md names real,
  // per-row actors ("faculty deactivation is performed by HOD; HOD
  // deactivation is performed by Principal") this router has no
  // per-row check to enforce today (unlike sendClassAlert's own
  // tutor_user_id comparison) — left as a conservative gap, not
  // silently narrowed to a role-only check that would be wrong for
  // one of the two cases. Revisit once a real per-row check exists.
  router.post('/staff/:id/deactivate', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await staffService.deactivateStaff(req.dbClient, req.params.id, { actorUserId: req.jwtClaims.sub });
      res.json(result);
    } catch (err) {
      if (mapStaffServiceError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/staff/:id', requirePermission('staff.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const staff = await staffService.removeStaff(req.dbClient, req.params.id, { userId: req.jwtClaims.sub });
    if (staff === null) {
      res.status(404).json({ detail: `No staff found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createStaffRouter;
