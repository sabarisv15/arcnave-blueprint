'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const analyticsService = require('../services/analyticsService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function createAnalyticsRouter() {
  const router = express.Router();

  // requirePermission('analytics.attendance_rate.read') —
  // permissions.js maps this to ['principal', 'hod'], the same pair
  // this route always used, not requireRole('principal') alone like
  // reports.js's writes, and not requireAuth like attendance.js's
  // reads: this is a read-only, no-side-effect oversight metric (no
  // service-level per-actor authorization logic of its own to defer
  // to, unlike attendance.js's markAttendance), so the route itself is
  // the only real gate here, same "the route has to be conservative"
  // reasoning reports.js's own comment gives. Both roles are named
  // because both are real consumers (PrincipalDashboard and
  // HodDashboard both surface this metric, per this slice's own
  // brief) — ordinary staff have no BusinessRules.md-named need to see
  // another tutor's class-level attendance rate.
  //
  // Response shape is exactly whatever analyticsService.
  // getAttendanceRateByClass returns — no reshaping here, per this
  // slice's own brief; the route is a thin wrapper, same "the service
  // decides the shape" convention every other route in this codebase
  // already follows.
  router.get('/analytics/attendance-rate', requirePermission('analytics.attendance_rate.read'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { class_id: classId, start_date: startDate, end_date: endDate } = req.query;
    const rows = await analyticsService.getAttendanceRateByClass(req.dbClient, { classId, startDate, endDate });
    res.json(rows);
  }));

  return router;
}

module.exports = createAnalyticsRouter;
