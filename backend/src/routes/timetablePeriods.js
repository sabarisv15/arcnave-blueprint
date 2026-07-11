'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/rbac');
const academicService = require('../services/academicService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as classes.js's CLASS_BODY_FIELDS. college_id
// is deliberately absent (always req.collegeId, never the request
// body).
const PERIOD_BODY_FIELDS = [
  ['day_of_week', 'dayOfWeek'],
  ['hour_index', 'hourIndex'],
  ['start_time', 'startTime'],
  ['end_time', 'endTime'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of PERIOD_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// classes.js/staff.js/students.js all made.

function mapAcademicServiceError(err, res) {
  if (err instanceof academicService.TimetablePeriodValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetablePeriodSlotTakenError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetablePeriodInUseError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetableImportError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

function createTimetablePeriodsRouter() {
  const router = express.Router();

  // RBAC here is the same deliberately conservative placeholder
  // classes.js/staff.js/students.js use, not a final decision.
  // BusinessRules.md names no specific actor for "who may define the
  // bell schedule" — requireRole('principal') gates writes,
  // requireAuth gates reads, same as every other Module 3 route.

  router.post('/timetable-periods', requireRole('principal'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const period = await academicService.createTimetablePeriod(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToServiceFields(req.body || {}) },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(period);
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/timetable-periods/import-csv', requireRole('principal'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const { file_name: fileName, file_base64: fileBase64 } = req.body || {};
      const result = await academicService.importTimetablePeriodsCsv(
        req.dbClient,
        { collegeId: req.collegeId, fileName, fileBuffer: fileBase64 ? Buffer.from(fileBase64, 'base64') : null },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json({
        raw_document_id: result.rawDocumentId,
        imported: result.imported,
        skipped: result.skipped,
        total_rows: result.totalRows,
      });
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/timetable-periods/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const period = await academicService.getTimetablePeriod(req.dbClient, req.params.id);
    if (period === null) {
      res.status(404).json({ detail: `No timetable period found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(period);
  }));

  // limit/offset are passed through as-is — academicService/
  // timetablePeriodRepository already default them to 50/0, not
  // re-implemented here, same as classes.js's own list route.
  router.get('/timetable-periods', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit: rawLimit, offset: rawOffset } = req.query;
    const periods = await academicService.listTimetablePeriods(req.dbClient, {
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
      offset: rawOffset === undefined ? undefined : Number(rawOffset),
    });
    res.json(periods);
  }));

  router.delete('/timetable-periods/:id', requireRole('principal'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const period = await academicService.removeTimetablePeriod(req.dbClient, req.params.id, { actorUserId: req.jwtClaims.sub });
      if (period === null) {
        res.status(404).json({ detail: `No timetable period found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createTimetablePeriodsRouter;
