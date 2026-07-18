'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const assessmentService = require('../services/assessmentService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapAssessmentServiceError(err, res) {
  if (err instanceof assessmentService.AssessmentTypeValidationError
    || err instanceof assessmentService.AssessmentMarkValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentTypeNameConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentMarkClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof assessmentService.AssessmentMarkNotAssignedFacultyError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function createAssessmentsRouter() {
  const router = express.Router();

  // BusinessRules.md Assessment marks: "assessment types are
  // institution-wide, configurable, editable by authorized
  // administrators" — requirePermission mapped to ['principal'], same
  // conservative default other institution-configuration actions in
  // this codebase use (nothing names a narrower authorized-administrator
  // role than Principal).
  router.post('/assessment-types', requirePermission('assessment_types.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { name, max_marks: maxMarks } = req.body || {};
    try {
      const assessmentType = await assessmentService.createAssessmentType(
        req.dbClient, { collegeId: req.collegeId, name, maxMarks }, { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(assessmentType);
    } catch (err) {
      if (mapAssessmentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/assessment-types', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit: rawLimit, offset: rawOffset } = req.query;
    const assessmentTypes = await assessmentService.listAssessmentTypes(req.dbClient, {
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
      offset: rawOffset === undefined ? undefined : Number(rawOffset),
    });
    res.json(assessmentTypes);
  }));

  router.put('/assessment-types/:id', requirePermission('assessment_types.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { name, max_marks: maxMarks } = req.body || {};
    try {
      const assessmentType = await assessmentService.updateAssessmentType(
        req.dbClient, req.params.id, { name, maxMarks }, { actorUserId: req.jwtClaims.sub },
      );
      if (assessmentType === null) {
        res.status(404).json({ detail: `No assessment type found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(assessmentType);
    } catch (err) {
      if (mapAssessmentServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth, not requirePermission: BusinessRules.md names the
  // assigned Subject Faculty as the actor —
  // assessmentService.recordMark's own faculty_allocation check
  // (AssessmentMarkNotAssignedFacultyError) is the real gate, same
  // "the service is the gate" reasoning every other assigned-Faculty
  // action in this codebase uses.
  router.post('/classes/:id/assessment-marks', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      academic_year: academicYear, subject, assessment_type_id: assessmentTypeId, student_id: studentId, marks_obtained: marksObtained,
    } = req.body || {};
    try {
      const mark = await assessmentService.recordMark(
        req.dbClient,
        {
          academicYear, classId: req.params.id, subject, assessmentTypeId, studentId, marksObtained,
        },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(mark);
    } catch (err) {
      if (mapAssessmentServiceError(err, res)) return;
      throw err;
    }
  }));

  // BusinessRules.md's own filter set: Academic Year, Department,
  // Class, Subject, Assessment — all optional, all combinable.
  router.get('/assessment-marks', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      academic_year: academicYear, department_id: departmentId, class_id: classId, subject, assessment_type_id: assessmentTypeId,
    } = req.query;
    const marks = await assessmentService.listMarksForFilters(req.dbClient, {
      academicYear, departmentId, classId, subject, assessmentTypeId,
    });
    res.json(marks);
  }));

  router.delete('/assessment-marks/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const mark = await assessmentService.removeMark(req.dbClient, req.params.id, { actorUserId: req.jwtClaims.sub });
    if (mark === null) {
      res.status(404).json({ detail: `No assessment mark found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createAssessmentsRouter;
