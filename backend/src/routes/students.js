'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const studentService = require('../services/studentService');
const phoneVerificationService = require('../services/phoneVerificationService');

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
  ['class_id', 'classId'],
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
  if (err instanceof studentService.StudentNotClassTutorError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentClassMismatchError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof studentService.StudentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function mapPhoneVerificationServiceError(err, res) {
  if (err instanceof phoneVerificationService.PhoneVerificationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationNoPhoneOnFileError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationNotRequestedError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationMaxAttemptsExceededError) {
    res.status(429).json({ detail: err.message });
    return true;
  }
  if (err instanceof phoneVerificationService.PhoneVerificationCodeMismatchError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

function createStudentsRouter() {
  const router = express.Router();

  // POST/PUT/DELETE /students: requirePermission maps each to the
  // roles that can EVER qualify (['staff'] for create; ['staff', 'hod',
  // 'principal'] for update/delete — middleware/permissions.js). The
  // real scope check — tutor -> own class, hod -> own department,
  // principal -> own college — is studentService's job
  // (createStudent/assertCanModifyStudent), resolved from real
  // classes.tutor_user_id/staff role assignments, never trusted from
  // the role claim alone. req.jwtClaims.role is passed through as
  // actorRole for exactly that resolution — it is itself trustworthy
  // (auth middleware already verified the JWT signature before this
  // route ever runs), just not sufficient on its own. Any authenticated
  // tenant user may still read.

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
        { userId: req.jwtClaims.sub, actorRole: req.jwtClaims.role },
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
    try {
      const student = await studentService.removeStudent(
        req.dbClient,
        req.params.id,
        { userId: req.jwtClaims.sub, actorRole: req.jwtClaims.role },
      );
      if (student === null) {
        res.status(404).json({ detail: `No student found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (mapStudentServiceError(err, res)) return;
      throw err;
    }
  }));

  // Phone OTP verification (item 1 of this session's task) —
  // requireAuth, not a narrower permission: any authenticated tenant
  // user working with a student's profile (front-office staff entering
  // a parent's number, the student themself via a future self-service
  // portal) can trigger/verify an OTP for that student's own record;
  // there's no BusinessRules.md-named narrower actor for this yet,
  // same reasoning students.js's own plain GET routes already use.
  router.post('/students/:id/phone-verification/otp', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await phoneVerificationService.requestOtp(
        req.dbClient,
        req.params.id,
        (req.body || {}).target,
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(result);
    } catch (err) {
      if (mapPhoneVerificationServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/students/:id/phone-verification/verify', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const student = await phoneVerificationService.verifyOtp(
        req.dbClient,
        req.params.id,
        (req.body || {}).target,
        (req.body || {}).code,
        { actorUserId: req.jwtClaims.sub },
      );
      res.json(student);
    } catch (err) {
      if (mapPhoneVerificationServiceError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createStudentsRouter;
