'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const financeService = require('../services/financeService');
const staffService = require('../services/staffService');
const studentService = require('../services/studentService');
const workflowService = require('../services/workflowService');

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
// No 'status' entry (unlike the first Finance slice): financeService
// no longer accepts a caller-supplied status at all (Module 8 second
// slice — see financeService.js's own header comment). A caller that
// still sends one is simply ignored, same as any other unrecognized
// field this map doesn't list.
const FEE_STRUCTURE_BODY_FIELDS = [
  ['academic_year', 'academicYear'],
  ['class_id', 'classId'],
  ['fee_category', 'feeCategory'],
  ['amount', 'amount'],
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
  if (err instanceof financeService.FeeStructureNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.ScholarshipStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.ScholarshipThresholdNotConfiguredError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.ScholarshipDecisionValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof financeService.ScholarshipDecisionNotTutorError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  // submitFeeStructureApproval's own error surface, per its file-level
  // comment: resolves the Principal via staffService.findPrincipal
  // (throws if none exists yet) then calls workflowService.submitRequest
  // (throws if a Pending request already governs this fee structure, or
  // if the resolved requestedByUserId/approverChain shape is somehow
  // invalid) — none of these are financeService's own error classes,
  // but this route is the one place they can actually surface.
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
  // The shared student read-access scope check (studentService.
  // assertCanViewStudent, via getStudent) surfaces this for both
  // per-student Finance routes below — same mapping routes/students.js
  // already uses for it.
  if (err instanceof studentService.StudentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function createFinanceRouter() {
  const router = express.Router();

  // RBAC here is the same deliberately conservative default
  // classes.js/staff.js/students.js/facultyAllocation.js use, not a
  // final decision. financeService has no authorization logic of its
  // own (unlike attendanceService.markAttendance's real
  // assertCanMark) — the route is the only gate, so it has to be
  // conservative. requirePermission('finance.fee_structures.create'/
  // 'update'/'finance.fee_payments.create') (all mapped to
  // ['principal'] in middleware/permissions.js) gates every write
  // (both fee_structures' create/update and fee_payments' mark — the
  // latter is "a simple write, no WorkflowService gate" per this
  // session's own framing, but it is still a write nothing in
  // BusinessRules.md names a specific actor for, e.g. an accounts
  // clerk or class tutor, so it gets the same conservative-default
  // treatment every other not-yet-named actor gets in this codebase);
  // requireAuth gates reads. Must be revisited once a real role model
  // exists for "who may change fee structures" / "who may mark a
  // student's fee paid" — that's a new permission mapping at that
  // point, not a new mechanism.

  // Scope note: only the five endpoints this session's own task names
  // are built — create/update/list for fee_structures, mark/
  // list-by-student for fee_payments. Every other router in this
  // codebase also exposes a plain GET /:id lookup; this one
  // deliberately does not, since it was never asked for and nothing
  // yet consumes it (no UI exists for Finance at all — see 326e8b5's
  // own .ai/RESULT.md). Add it in a later slice if a real screen needs
  // it, not speculatively here.

  router.post('/finance/fee-structures', requirePermission('finance.fee_structures.create'), asyncHandler(async (req, res) => {
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

  router.put('/finance/fee-structures/:id', requirePermission('finance.fee_structures.update'), asyncHandler(async (req, res) => {
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

  // Module 8 final slice: submitFeeStructureApproval was built
  // (Module 8 second slice) but never wired to a route — a fee
  // structure created above stays 'Pending Approval' forever with no
  // way to actually start the real approval chain. This is that
  // trigger point.
  //
  // requireAuth, deliberately NOT the principal-mapped permission gate
  // create/update above use — same reasoning routes/staff.js's own
  // submit-registration route now documents: this chain is single-step,
  // Principal-only (financeService.js's own header comment). Gating
  // submission to principal-only would mean requestedByUserId is
  // always the Principal's own user_id, which is also the chain's only
  // (and therefore final) step's resolved approver — ADR-005's
  // self-approval rule would reject every submission outright. The
  // workflow chain's own step-matching + self-approval checks are the
  // real gate, not this route's RBAC.
  router.post('/finance/fee-structures/:id/submit-approval', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const workflowRequest = await financeService.submitFeeStructureApproval(
        req.dbClient,
        req.params.id,
        { requestedByUserId: req.jwtClaims.sub },
      );
      res.status(201).json(workflowRequest);
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
  router.post('/finance/fee-payments', requirePermission('finance.fee_payments.create'), asyncHandler(async (req, res) => {
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
  // table). requireAuth only gates "must be logged in" — the real
  // scope (tutor/faculty-allocated teacher of the student's own class,
  // hod of their department, principal of their college) is
  // financeService/studentService's job (this session's own task: this
  // route used to let any authenticated user pull any student's
  // payment history).
  router.get('/finance/fee-payments', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { student_id: studentId } = req.query;
    if (!studentId) {
      res.status(400).json({ detail: 'student_id query parameter is required' });
      return;
    }
    try {
      const payments = await financeService.listFeePaymentsForStudent(req.dbClient, studentId, {
        actorUserId: req.jwtClaims.sub, actorRole: req.jwtClaims.role,
      });
      res.json(payments);
    } catch (err) {
      if (mapFinanceServiceError(err, res)) return;
      throw err;
    }
  }));

  // BusinessRules.md Finance / this session's own task: scholarship
  // eligibility from a student's annual_income against this tenant's
  // configured threshold. requireAuth, not the principal-mapped
  // permission gate the write routes above use — this is a read, same
  // reasoning GET /finance/fee-structures already uses; the real scope
  // (same tutor/faculty-allocated teacher/hod/principal boundary as
  // every other student-data read) is enforced inside
  // checkScholarshipEligibility via studentService, not this route
  // (this session's own task: this route used to let any authenticated
  // user pull any student's scholarship data).
  // Advisory only — see financeService.checkScholarshipEligibility's
  // own comment. Never the eligibility outcome; recordScholarshipDecision
  // below is.
  router.get('/finance/students/:id/scholarship-eligibility', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await financeService.checkScholarshipEligibility(req.dbClient, req.collegeId, req.params.id, {
        actorUserId: req.jwtClaims.sub, actorRole: req.jwtClaims.role,
      });
      res.json(result);
    } catch (err) {
      if (mapFinanceServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth, not requirePermission: BusinessRules.md names the
  // Class Tutor as the actor — financeService.recordScholarshipDecision's
  // own tutor_user_id check (ScholarshipDecisionNotTutorError) is the
  // real gate, same "the service is the gate" reasoning every other
  // Tutor-scoped action in this codebase uses.
  router.post('/finance/students/:id/scholarship-decisions', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      scheme_name: schemeName, eligible, reason, supporting_document_id: supportingDocumentId,
    } = req.body || {};
    try {
      const decision = await financeService.recordScholarshipDecision(
        req.dbClient, req.params.id, { schemeName, eligible, reason, supportingDocumentId }, { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(decision);
    } catch (err) {
      if (mapFinanceServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/finance/students/:id/scholarship-decisions', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const decisions = await financeService.listScholarshipDecisionsForStudent(req.dbClient, req.params.id);
    res.json(decisions);
  }));

  return router;
}

module.exports = createFinanceRouter;
