'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/rbac');
const financeService = require('../services/financeService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// Mounted at /finance/... (not flat like /classes, /attendance,
// /staff, /students, /faculty-allocation, /timetable-periods) — a
// deliberate deviation from this codebase's dominant flat-router
// convention, per this session's own explicit instruction ("Routes
// under /api/v1/finance/..."). CLAUDE.md rule 5 ("All API routes live
// under /api/v1/") is satisfied the same way every other router
// satisfies it: app.js's app.use('/api/v1', createTenantApp()) supplies
// that outer prefix; this file only ever registers paths relative to
// it, same as every other router in src/routes/.
//
// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as classes.js's CLASS_BODY_FIELDS/attendance.js's
// ATTENDANCE_BODY_FIELDS. college_id is deliberately absent from both
// (always req.collegeId, never the request body).
const FEE_STRUCTURE_BODY_FIELDS = [
  ['academic_year', 'academicYear'],
  ['class_id', 'classId'],
  ['fee_category', 'feeCategory'],
  ['amount', 'amount'],
  ['status', 'status'],
  ['remarks', 'remarks'],
];

const FEE_PAYMENT_BODY_FIELDS = [
  ['student_id', 'studentId'],
  ['fee_structure_id', 'feeStructureId'],
  ['status', 'status'],
  ['receipt_document_id', 'receiptDocumentId'],
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

// Response bodies are NOT translated back to camelCase — same choice
// classes.js/attendance.js/staff.js/students.js/facultyAllocation.js
// all made.

function mapFinanceServiceError(err, res) {
  if (err instanceof financeService.FeeStructureValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeeStructureStatusError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeeStructureConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeeStructureClassNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentStatusError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentFeeStructureNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.FeePaymentConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

function createFinanceRouter() {
  const router = express.Router();

  // RBAC here is the same deliberately conservative placeholder
  // classes.js/staff.js/students.js/facultyAllocation.js use, not a
  // final decision. financeService has no authorization logic of its
  // own (unlike attendanceService.markAttendance's real
  // assertCanMark) — the route is the only gate, so it has to be
  // conservative. requireRole('principal') gates every write (both
  // fee_structures' create/update and fee_payments' mark — the latter
  // is "a simple write, no WorkflowService gate" per this session's
  // own framing, but it is still a write nothing in BusinessRules.md
  // names a specific actor for, e.g. an accounts clerk or class tutor,
  // so it gets the same placeholder treatment every other
  // not-yet-named actor gets in this codebase); requireAuth gates
  // reads. Must be revisited once a real role model exists for "who
  // may change fee structures" / "who may mark a student's fee paid."

  // Scope note: only the five endpoints this session's own task names
  // are built — create/update/list for fee_structures, mark/
  // list-by-student for fee_payments. Every other router in this
  // codebase also exposes a plain GET /:id lookup; this one
  // deliberately does not, since it was never asked for and nothing
  // yet consumes it (no UI exists for Finance at all — see 326e8b5's
  // own .ai/RESULT.md). Add it in a later slice if a real screen needs
  // it, not speculatively here.

  router.post('/finance/fee-structures', requireRole('principal'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const feeStructure = await financeService.createFeeStructure(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToFields(req.body || {}, FEE_STRUCTURE_BODY_FIELDS) },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(feeStructure);
    } catch (err) {
      if (mapFinanceServiceError(err, res)) return;
      throw err;
    }
  }));

  router.put('/finance/fee-structures/:id', requireRole('principal'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const feeStructure = await financeService.updateFeeStructure(
        req.dbClient,
        req.params.id,
        bodyToFields(req.body || {}, FEE_STRUCTURE_BODY_FIELDS),
        { userId: req.jwtClaims.sub },
      );
      if (feeStructure === null) {
        res.status(404).json({ detail: `No fee structure found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(feeStructure);
    } catch (err) {
      if (mapFinanceServiceError(err, res)) return;
      throw err;
    }
  }));

  // class_id and academic_year are optional, but must be provided
  // together, or not at all: financeService.listFeeStructuresForClassAndYear
  // takes both as required positional arguments (there is no
  // "class_id only" or "academic_year only" lookup to fall back to),
  // so a partial pair is rejected outright rather than silently
  // ignored — same "reject an ambiguous partial filter instead of
  // guessing" reasoning facultyAllocation.js's own list route uses for
  // its class_id/staff_user_id pair, inverted here (both-or-neither
  // instead of exactly-one). Neither provided falls through to the
  // plain paginated listFeeStructures, same shape classes.js's own
  // GET /classes uses.
  router.get('/finance/fee-structures', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { class_id: classId, academic_year: academicYear, limit: rawLimit, offset: rawOffset } = req.query;

    if (classId && academicYear) {
      const feeStructures = await financeService.listFeeStructuresForClassAndYear(req.dbClient, classId, academicYear);
      res.json(feeStructures);
      return;
    }
    if (classId || academicYear) {
      res.status(400).json({ detail: 'class_id and academic_year must be provided together, or neither' });
      return;
    }

    const feeStructures = await financeService.listFeeStructures(req.dbClient, {
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
      offset: rawOffset === undefined ? undefined : Number(rawOffset),
    });
    res.json(feeStructures);
  }));

  // 200, not 201: markFeePayment is a real mark-or-re-mark upsert, same
  // reasoning attendance.js's own POST /attendance uses for
  // markAttendance — the service's return value doesn't distinguish
  // create from update, so there's nothing here to key a 201 off of
  // without changing markFeePayment's own contract, which this slice
  // doesn't do.
  router.post('/finance/fee-payments', requireRole('principal'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const payment = await financeService.markFeePayment(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToFields(req.body || {}, FEE_PAYMENT_BODY_FIELDS) },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(200).json(payment);
    } catch (err) {
      if (mapFinanceServiceError(err, res)) return;
      throw err;
    }
  }));

  // student_id is required — this is specifically the "list-by-student"
  // endpoint this session's own task names, not a general/unscoped fee
  // payments list (no such lookup exists on financeService either,
  // same "don't wrap what nothing needs yet" restraint
  // facultyAllocation.js's own list route documents for its own
  // table).
  router.get('/finance/fee-payments', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { student_id: studentId } = req.query;
    if (!studentId) {
      res.status(400).json({ detail: 'student_id query parameter is required' });
      return;
    }
    const payments = await financeService.listFeePaymentsForStudent(req.dbClient, studentId);
    res.json(payments);
  }));

  return router;
}

module.exports = createFinanceRouter;
