'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const studentService = require('../services/studentService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, because this is the only file that needs it so far.
// StudentEditorModal.jsx (the frontend this module will eventually
// repoint) already POSTs snake_case matching the DB columns directly
// (see its handleSave) — translating at this boundary, once, keeps
// the later UI-repoint slice a URL/fetch-path change, not a
// payload-reshaping one. college_id is deliberately absent from this
// map: it comes from req.collegeId, never the request body.
const STUDENT_BODY_FIELDS = [
  ['roll_no', 'rollNo'],
  ['full_name', 'fullName'],
  ['gender', 'gender'],
  ['entry_type', 'entryType'],
  ['emis_number', 'emisNumber'],
  ['umis_number', 'umisNumber'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['phone_verified', 'phoneVerified'],
  ['parent_name', 'parentName'],
  ['parent_phone', 'parentPhone'],
  ['parent_phone_verified', 'parentPhoneVerified'],
  ['address', 'address'],
  ['pincode', 'pincode'],
  ['mark_10th', 'mark10th'],
  ['mark_12th', 'mark12th'],
  ['mark_iti', 'markIti'],
  ['accommodation', 'accommodation'],
  ['club', 'club'],
  ['internship', 'internship'],
  ['career_plan', 'careerPlan'],
  ['notes', 'notes'],
  ['license_number', 'licenseNumber'],
  ['bike_number', 'bikeNumber'],
  ['annual_income', 'annualIncome'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of STUDENT_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — this returns
// studentRepository's native row shape (snake_case, since that's what
// Postgres returns) as-is. Picked over a reverse-translation step
// because it's strictly less code here, and StudentEditorModal.jsx
// already expects snake_case field names throughout, matching what
// this returns without any further reshaping at repoint time either.

function mapStudentServiceError(err, res) {
  if (err instanceof studentService.StudentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentRollNoConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

function createStudentsRouter() {
  const router = express.Router();

  // RBAC here is a deliberately conservative placeholder, not a final
  // decision — same situation configurations.js was already in and
  // handled the same way. BusinessRules.md's real rule (only the
  // assigned Class Tutor may edit; only faculty assigned via the
  // timetable may view) can't be enforced correctly today: "Class
  // Tutor" isn't a resolved role yet (BusinessRules.md flags this as
  // open, to be settled in Module 2), and there's no timetable/
  // assignment data to check against yet either (Module 3, not
  // built). Until then: any authenticated tenant user may read,
  // requireRole('principal') gates writes — a real, working role
  // already used elsewhere in this codebase, not a guess at the
  // eventual Class Tutor model. Must be revisited once Module 2
  // resolves that question.

  router.post('/students', requirePermission('students.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const student = await studentService.createStudent(req.dbClient, {
        collegeId: req.collegeId,
        userId: req.jwtClaims.sub,
        ...bodyToServiceFields(req.body || {}),
      });
      res.status(201).json(student);
    } catch (err) {
      if (mapStudentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/students/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const student = await studentService.getStudent(req.dbClient, req.params.id);
    if (student === null) {
      res.status(404).json({ detail: `No student found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(student);
  }));

  // limit/offset are passed through as-is — studentService/
  // studentRepository already default them to 50/0, not
  // re-implemented here.
  router.get('/students', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit: rawLimit, offset: rawOffset } = req.query;
    const students = await studentService.listStudents(req.dbClient, {
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
      offset: rawOffset === undefined ? undefined : Number(rawOffset),
    });
    res.json(students);
  }));

  router.put('/students/:id', requirePermission('students.update'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const student = await studentService.updateStudent(
        req.dbClient,
        req.params.id,
        bodyToServiceFields(req.body || {}),
        { userId: req.jwtClaims.sub },
      );
      if (student === null) {
        res.status(404).json({ detail: `No student found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(student);
    } catch (err) {
      if (mapStudentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/students/:id', requirePermission('students.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const student = await studentService.removeStudent(req.dbClient, req.params.id, { userId: req.jwtClaims.sub });
    if (student === null) {
      res.status(404).json({ detail: `No student found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createStudentsRouter;
