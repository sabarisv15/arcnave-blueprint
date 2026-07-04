'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const attendanceService = require('../services/attendanceService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as classes.js/facultyAllocation.js's own
// *_BODY_FIELDS. college_id is deliberately absent (always
// req.collegeId, never the request body). absent_student_ids is
// passed straight through as the JSON array express.json() already
// parsed it into — attendanceService.markAttendance is the one that
// JSON.stringify's it before handing it to the repository (see that
// file's own comment on why), not this route.
const ATTENDANCE_BODY_FIELDS = [
  ['class_id', 'classId'],
  ['session_date', 'sessionDate'],
  ['hour_index', 'hourIndex'],
  ['absent_student_ids', 'absentStudentIds'],
  ['total_students', 'totalStudents'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of ATTENDANCE_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// classes.js/facultyAllocation.js/staff.js/students.js all made.

function mapAttendanceServiceError(err, res) {
  if (err instanceof attendanceService.AttendanceValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  // "Not Approved" and "locked" are both "this resource isn't in a
  // state that allows this action right now" — the same state-
  // conflict semantics ClassNameConflictError/FacultyAllocationPeriodTakenError
  // already use 409 for elsewhere in this codebase, not a new
  // convention invented here.
  if (err instanceof attendanceService.AttendanceTimetableNotApprovedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceLockedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof attendanceService.AttendanceSessionConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  // Authenticated but not permitted to mark *this* class's attendance
  // — the same 403 rbac.js's requireRole already uses for "wrong
  // role," extended here to a per-row authorization decision
  // requireRole can't express (see the router's own comment on why
  // this route doesn't gate writes with requireRole at all).
  if (err instanceof attendanceService.AttendanceForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function createAttendanceRouter() {
  const router = express.Router();

  // RBAC here deliberately does NOT follow classes.js/staff.js/
  // students.js/facultyAllocation.js's requireRole('principal')-for-
  // writes convention. Those services have no authorization logic of
  // their own — the route is the only gate, so it has to be
  // conservative. attendanceService.markAttendance is different: it
  // already enforces BusinessRules.md's real, three-actor rule itself
  // (class tutor, HOD force-mark, or the staff member genuinely
  // scheduled for the period — see attendanceService.js's own
  // assertCanMark), mapped to a 403 via AttendanceForbiddenError
  // above. Gating this route with requireRole('principal') would
  // silently override that and lock out every actor BusinessRules.md
  // actually names as eligible — ordinary teaching staff and class
  // tutors are not principals. requireAuth (any authenticated tenant
  // user) is the correct, and only correct, route-level gate here;
  // the service is where the real decision is made.

  router.post('/attendance', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const session = await attendanceService.markAttendance(
        req.dbClient,
        bodyToServiceFields(req.body || {}),
        { actorUserId: req.jwtClaims.sub, actorRole: req.jwtClaims.role },
      );
      // 200, not 201: markAttendance is a real mark-or-re-mark upsert
      // (StaffDashboard.jsx's own "Mark Attendance"/"Update Attendance"
      // button is the same handler either way — see that file's own
      // comment), and the service's return value doesn't distinguish
      // which happened, so there's nothing here to key a 201 off of
      // without changing markAttendance's own contract, which this
      // slice doesn't do.
      res.status(200).json(session);
    } catch (err) {
      if (mapAttendanceServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/attendance/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const session = await attendanceService.getAttendanceSession(req.dbClient, req.params.id);
    if (session === null) {
      res.status(404).json({ detail: `No attendance session found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(session);
  }));

  // Both class_id and session_date are required — unlike
  // facultyAllocation.js's "exactly one of two" list filter,
  // attendanceService.listAttendanceSessionsForClassAndDate takes
  // both as required positional arguments, not an either/or choice.
  router.get('/attendance', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { class_id: classId, session_date: sessionDate } = req.query;
    if (!classId || !sessionDate) {
      res.status(400).json({ detail: 'class_id and session_date query parameters are both required' });
      return;
    }
    const sessions = await attendanceService.listAttendanceSessionsForClassAndDate(req.dbClient, classId, sessionDate);
    res.json(sessions);
  }));

  // No DELETE route: attendance_sessions is soft-delete only per
  // BusinessRules.md's AI section, and any real deletion is an
  // approval-gated action ("even with approval") — WorkflowService
  // (Module 8) doesn't exist yet, and attendanceService.js itself
  // exposes no softDelete wrapper to call even if a route wanted to
  // (attendanceRepository.softDelete is unwrapped, same "don't invent
  // structure nobody asked for yet" restraint applied elsewhere).

  return router;
}

module.exports = createAttendanceRouter;
