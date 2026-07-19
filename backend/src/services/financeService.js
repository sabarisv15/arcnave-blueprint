'use strict';

// Business logic for Module 5's `fee_structures` and `fee_payments` —
// validation and audit logging on top of financeRepository.js/
// feePaymentRepository.js, neither of which does either (CLAUDE.md
// rule 1: AI tools call Business Services, never repositories
// directly — this file is what makes that possible for Finance).
// Never calls one repository from the other, and never composes a
// different service's repository directly (CLAUDE.md rule 4;
// Architecture.md 2.5 — FinanceService owns fee_structures and
// fee_payments only).
//
// BusinessRules.md Finance: "Fee changes require approval before
// taking effect." CLAUDE.md rule 3: WorkflowService is the sole
// approval gate, human and AI Level 3 actions alike, no exceptions.
//
// Module 8 second slice: this gate is now real.
// submitFeeStructureApproval/approveFeeStructure/rejectFeeStructure
// route through workflowService — the actual fix for the gap 6957f02's
// own commit message named explicitly ("no status control at all...
// the one thing that rule exists to prevent [self-approval]"). `status`
// is no longer in FEE_STRUCTURE_ALLOWED_FIELDS: createFeeStructure/
// updateFeeStructure can no longer set it directly — a fee_structures
// row is always created 'Pending Approval' (the DB's own default) and
// can only move to 'Approved'/'Rejected' via the new functions below,
// which themselves only ever run after workflowService.approveRequest/
// rejectRequest actually resolves a real approval. Previously (see
// 8e5a3d5's own .ai/RESULT.md) status was merely known-literal-
// validated with no real gate at all; that validation apparatus
// (VALID_FEE_STRUCTURE_STATUSES/assertValidFeeStructureStatus/
// FeeStructureStatusError) is removed as dead code now that external
// callers can no longer reach it.
//
// approverChain resolution is a single step (Principal only) —
// unlike StaffService's Faculty->HOD->Principal chain, nothing in
// BusinessRules.md or this schema scopes a fee_structures row to one
// department, so there is no HOD to resolve here. Reused from
// staffService.findPrincipal (staff+users, real data — see that
// file's own comment) rather than duplicated.
//
// fee_payments' markFeePayment has no such gate at all, by design:
// BusinessRules.md's approval rule is about "fee changes"
// (fee_structures), not the payment flag — this session's own task
// instruction is explicit that marking paid/not-paid is "a simple
// write, no WorkflowService gate," a manual student-profile action,
// not a fee change.
//
// Both removeX functions are soft-delete only: neither repository
// exposes a hard-delete function at all (see each migration's own
// file-level comment — BusinessRules.md's AI section names "fees"
// explicitly for soft-delete-only), so there is no hard-delete branch
// to accidentally call here, structurally, not just by convention.

const financeRepository = require('../repositories/financeRepository');
const feePaymentRepository = require('../repositories/feePaymentRepository');
const scholarshipDecisionRepository = require('../repositories/scholarshipDecisionRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const workflowService = require('./workflowService');
const staffService = require('./staffService');
const studentService = require('./studentService');
const classRepository = require('../repositories/classRepository');
const configurationService = require('./configurationService');

// Missing academicYear, classId, feeCategory, or amount — fee_structures'
// own NOT NULL columns (aside from college_id, which always comes from
// tenant-scoped request context, never caller free text — same
// exclusion academicService.js's createClass/ALLOWED_FIELDS makes for
// classes.college_id). Raised before any repository call, same as
// every other pre-query guard in this codebase.
class FeeStructureValidationError extends Error {}

// fee_structures_college_year_class_category_key (the partial unique
// index) violated (Postgres 23505) — this class/year/category
// combination already has a live fee line.
class FeeStructureConflictError extends Error {}

// fee_structures_class_id_fkey violated (Postgres 23503) — the given
// classId doesn't exist.
class FeeStructureClassNotFoundError extends Error {}

// submitFeeStructureApproval/approveFeeStructure/rejectFeeStructure
// given an id with no matching row — a required lookup (collegeId
// drives the workflow submission/lookup), not an optional fetch, same
// precedent workflowService.WorkflowRequestNotFoundError already set.
class FeeStructureNotFoundError extends Error {}

// approveFeeStructure/rejectFeeStructure called for a fee structure
// with no live Pending workflow_requests row (never submitted for
// approval, or already resolved).
class FeeStructureNoPendingRequestError extends Error {}

// Missing collegeId, studentId, feeStructureId, actorUserId, or
// status — fee_payments' own NOT NULL columns, plus the actor identity
// markFeePayment cannot proceed without (same reasoning
// attendanceService.markAttendance's own actor-identity guard gives).
// status is required, not defaulted: "mark paid/not-paid" is the
// entire point of this action, so a caller that omits it has a bug
// worth surfacing, not a silent 'not_paid' fallback to paper over it —
// unlike fee_structures.status, which genuinely has a sensible
// unattended default (a newly created fee line really is
// "Pending Approval" until someone acts on it).
class FeePaymentValidationError extends Error {}

// Known real fee_payments.status values — 'paid' or 'not_paid', per
// this session's own task instruction (a manual flag, no amount/
// ledger states).
class FeePaymentStatusError extends Error {}

// fee_payments_student_id_fkey violated (Postgres 23503) — the given
// studentId doesn't exist.
class FeePaymentStudentNotFoundError extends Error {}

// fee_payments_fee_structure_id_fkey violated (Postgres 23503) — the
// given feeStructureId doesn't exist.
class FeePaymentFeeStructureNotFoundError extends Error {}

// fee_payments_student_fee_structure_key (the partial unique index)
// violated (Postgres 23505) on a raw INSERT race — markFeePayment's
// own find-then-create/update flow avoids hitting this in the normal
// case (see below), so this only fires if two concurrent callers mark
// the identical (student_id, fee_structure_id) at the same instant.
// Same shape as attendanceService.AttendanceSessionConflictError.
class FeePaymentConflictError extends Error {}

// checkScholarshipEligibility given a studentId with no matching row.
class ScholarshipStudentNotFoundError extends Error {}

// checkScholarshipEligibility's tenant has never configured
// ConfigurationService category 'finance''s scholarshipIncomeThreshold
// key (BusinessRules.md Finance: "exact threshold is per-tenant
// config, not hardcoded"). Distinct from a normal "not eligible"
// result: a missing threshold means the question can't be answered
// yet, an administrative gap this tenant needs to fix, not a real
// eligibility outcome.
class ScholarshipThresholdNotConfiguredError extends Error {}

// Missing schemeName, or eligible not a boolean —
// recordScholarshipDecision's own required inputs.
class ScholarshipDecisionValidationError extends Error {}

// recordScholarshipDecision called by a user who is not the student's
// current class's tutor — BusinessRules.md Scholarship: "the Class
// Tutor reviews students and marks each one Eligible or Not Eligible."
// Same per-row identity check studentService.createStudent's own
// StudentNotClassTutorError already establishes for a Tutor-scoped
// action, not a role-only check.
class ScholarshipDecisionNotTutorError extends Error {}

const VALID_FEE_PAYMENT_STATUSES = ['paid', 'not_paid'];

// The fields this service accepts for fee_structures create/update,
// deliberately listed here rather than trusting financeRepository's
// own COLUMNS whitelist to be the only line of defense — same
// defense-in-depth reasoning as academicService.js/studentService.js/
// staffService.js's own ALLOWED_FIELDS. collegeId is excluded: a fee
// structure's tenant is set once at creation and never moves via
// update, same as classes/students/staff. `status` is deliberately
// excluded too, unlike the first Finance slice — see this file's own
// header comment: it can no longer be set directly at all, only via
// approveFeeStructure/rejectFeeStructure below.
const FEE_STRUCTURE_ALLOWED_FIELDS = [
  'academicYear',
  'classId',
  'feeCategory',
  'amount',
  'remarks',
];

function pickFeeStructureFields(source) {
  const result = {};
  for (const key of FEE_STRUCTURE_ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function assertValidFeePaymentStatus(status) {
  if (!VALID_FEE_PAYMENT_STATUSES.includes(status)) {
    throw new FeePaymentStatusError(`status ${JSON.stringify(status)} is not a known value`);
  }
}

async function createFeeStructure(client, { collegeId, academicYear, classId, feeCategory, amount, ...rest }, { actorUserId } = {}) {
  if (!academicYear || !classId || !feeCategory || amount === undefined || amount === null) {
    throw new FeeStructureValidationError('academicYear, classId, feeCategory, and amount are required');
  }

  let feeStructure;
  try {
    feeStructure = await financeRepository.create(client, {
      collegeId,
      academicYear,
      classId,
      feeCategory,
      amount,
      ...pickFeeStructureFields(rest),
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'fee_structures_college_year_class_category_key') {
      throw new FeeStructureConflictError(
        `a fee structure for class ${JSON.stringify(classId)}, year ${JSON.stringify(academicYear)}, category ${JSON.stringify(feeCategory)} already exists`,
      );
    }
    if (err.code === '23503' && err.constraint === 'fee_structures_class_id_fkey') {
      throw new FeeStructureClassNotFoundError(`classId ${JSON.stringify(classId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'fee_structure_created',
    entity: 'fee_structures',
    entityId: feeStructure.id,
    metadata: null,
  });

  return feeStructure;
}

// null means no fee structure exists with this id — not an error. The
// route turns that into 404, same as academicService.getClass.
async function getFeeStructure(client, id) {
  return financeRepository.findById(client, id);
}

async function updateFeeStructure(client, id, fields, { userId } = {}) {
  const patch = pickFeeStructureFields(fields);
  const hasChanges = Object.keys(patch).length > 0;

  let feeStructure;
  try {
    feeStructure = await financeRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'fee_structures_college_year_class_category_key') {
      throw new FeeStructureConflictError(
        `a fee structure for this class/year/category already exists`,
      );
    }
    if (err.code === '23503' && err.constraint === 'fee_structures_class_id_fkey') {
      throw new FeeStructureClassNotFoundError(`classId ${JSON.stringify(patch.classId)} does not exist`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // financeRepository.update falls back to a plain findById then).
  // feeStructure !== null guards the id-not-found (or already
  // soft-deleted, since financeRepository.update's own WHERE already
  // filters deleted_at IS NULL) case. Either way, no row was actually
  // changed, so no audit entry — same shape as academicService.updateClass.
  if (hasChanges && feeStructure !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: feeStructure.college_id,
      userId,
      action: 'fee_structure_updated',
      entity: 'fee_structures',
      entityId: id,
      metadata: null,
    });
  }

  return feeStructure;
}

// Soft-delete only: financeRepository has no hard-delete function at
// all. softDelete's own WHERE guard means an already-deleted or
// missing id simply returns null (no error, no audit entry) — same
// idempotent shape the repository layer already documents.
async function removeFeeStructure(client, id, { userId } = {}) {
  const feeStructure = await financeRepository.softDelete(client, id);
  if (feeStructure === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: feeStructure.college_id,
    userId,
    action: 'fee_structure_removed',
    entity: 'fee_structures',
    entityId: id,
    metadata: null,
  });

  return feeStructure;
}

async function listFeeStructuresForClassAndYear(client, classId, academicYear) {
  return financeRepository.findByClassAndYear(client, classId, academicYear);
}

async function listFeeStructures(client, { limit, offset } = {}) {
  return financeRepository.list(client, { limit, offset });
}

// Submits a newly-created (always 'Pending Approval') fee structure
// for real approval — a separate, explicit step from createFeeStructure
// itself, not auto-triggered on every create: mirrors
// staffService.submitStaffRegistration's own separation from
// createStaff, keeping the existing, already-tested creation path
// unchanged. Single-step chain (Principal only) — see this file's own
// header comment for why there's no HOD step here the way Staff's
// chain has one.
async function submitFeeStructureApproval(client, feeStructureId, { requestedByUserId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new FeeStructureValidationError('requestedByUserId is required');
  }

  const feeStructure = await financeRepository.findById(client, feeStructureId);
  if (feeStructure === null) {
    throw new FeeStructureNotFoundError(`fee structure ${JSON.stringify(feeStructureId)} does not exist`);
  }

  const principal = await staffService.findPrincipal(client, feeStructure.college_id);

  return workflowService.submitRequest(client, {
    collegeId: feeStructure.college_id,
    entityType: 'fee_structure',
    entityId: feeStructure.id,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'principal', user_id: principal.user_id }],
  });
}

// Shared lookup for approve/reject: the fee structure must exist, and
// exactly one live Pending workflow_requests row must govern it.
async function loadPendingFeeStructureApproval(client, feeStructureId) {
  const feeStructure = await financeRepository.findById(client, feeStructureId);
  if (feeStructure === null) {
    throw new FeeStructureNotFoundError(`fee structure ${JSON.stringify(feeStructureId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'fee_structure', feeStructureId);
  if (pending === null) {
    throw new FeeStructureNoPendingRequestError(`fee structure ${JSON.stringify(feeStructureId)} has no pending approval request`);
  }

  return { feeStructure, pending };
}

// The actual fix for 6957f02's own named gap: status now only ever
// moves to 'Approved' as a consequence of a real
// workflowService.approveRequest resolution (which itself enforces
// ADR-005's self-approval rule, the wrong-actor/wrong-step rejection,
// etc.) — never from a bare caller-supplied field on update. A single-
// step chain always resolves on this one call (current_step never
// advances past 1), so there's no "still mid-chain" branch to handle
// the way a multi-step StaffService chain would need.
async function approveFeeStructure(client, feeStructureId, { actorUserId, remarks } = {}) {
  const { pending } = await loadPendingFeeStructureApproval(client, feeStructureId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const feeStructure = await financeRepository.update(client, feeStructureId, { status: 'Approved' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: feeStructure.college_id,
    userId: actorUserId,
    action: 'fee_structure_approved',
    entity: 'fee_structures',
    entityId: feeStructureId,
    metadata: null,
  });

  return feeStructure;
}

async function rejectFeeStructure(client, feeStructureId, { actorUserId, remarks } = {}) {
  const { pending } = await loadPendingFeeStructureApproval(client, feeStructureId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  const feeStructure = await financeRepository.update(client, feeStructureId, { status: 'Rejected' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: feeStructure.college_id,
    userId: actorUserId,
    action: 'fee_structure_rejected',
    entity: 'fee_structures',
    entityId: feeStructureId,
    metadata: null,
  });

  return feeStructure;
}

// Marks a student's fee line paid/not-paid — an upsert, same
// find-then-create/update shape as attendanceService.markAttendance,
// except with no approval/authorization gate to check first (see the
// file-level comment: this is explicitly not a "fee change"). Whoever
// is marking it (markedByUserId, always the authenticated actor —
// never separately validated against a users FK error, same precedent
// attendance_sessions.marked_by_user_id already set: it's the actor,
// not caller-supplied free text naming someone else) is re-stamped on
// every call, even a re-mark of an existing row — the flag's history
// is "who set it last," not "who first created the row," matching
// this session's own "set from the student profile screen" framing
// (an action performed now, by whoever is looking at the screen now).
// collegeId is a direct parameter, not derived from a lookup — the
// dominant house convention every other createX in this codebase uses
// (createClass/createStudent/createFeeStructure), unlike
// attendanceService.markAttendance's one exception (it already needed
// a class lookup for authorization, so reused cls.college_id for
// convenience; there's no equivalent lookup markFeePayment needs).
async function markFeePayment(client, { collegeId, studentId, feeStructureId, status, receiptDocumentId }, { actorUserId } = {}) {
  if (!collegeId || !studentId || !feeStructureId || !actorUserId || !status) {
    throw new FeePaymentValidationError('collegeId, studentId, feeStructureId, actorUserId, and status are required');
  }
  assertValidFeePaymentStatus(status);

  const existing = await feePaymentRepository.findByStudentAndFeeStructure(client, studentId, feeStructureId);

  const patch = {
    status,
    markedByUserId: actorUserId,
    receiptDocumentId,
  };

  let payment;
  let wasUpdate;
  if (existing !== null) {
    payment = await feePaymentRepository.update(client, existing.id, patch);
    wasUpdate = true;
  } else {
    try {
      payment = await feePaymentRepository.create(client, {
        collegeId,
        studentId,
        feeStructureId,
        ...patch,
      });
    } catch (err) {
      if (err.code === '23503' && err.constraint === 'fee_payments_student_id_fkey') {
        throw new FeePaymentStudentNotFoundError(`studentId ${JSON.stringify(studentId)} does not exist`);
      }
      if (err.code === '23503' && err.constraint === 'fee_payments_fee_structure_id_fkey') {
        throw new FeePaymentFeeStructureNotFoundError(`feeStructureId ${JSON.stringify(feeStructureId)} does not exist`);
      }
      if (err.code === '23505' && err.constraint === 'fee_payments_student_fee_structure_key') {
        throw new FeePaymentConflictError(
          `fee payment for student ${JSON.stringify(studentId)}, fee structure ${JSON.stringify(feeStructureId)} was just marked by someone else`,
        );
      }
      throw err;
    }
    wasUpdate = false;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: wasUpdate ? 'fee_payment_remarked' : 'fee_payment_marked',
    entity: 'fee_payments',
    entityId: payment.id,
    metadata: null,
  });

  return payment;
}

// null means no fee payment exists with this id — not an error. The
// route turns that into 404, same as getFeeStructure.
async function getFeePayment(client, id) {
  return feePaymentRepository.findById(client, id);
}

// The natural "every fee mark for this student" lookup a student
// profile screen needs. actorUserId/actorRole are optional for the
// same reason studentService.getStudent's are: a future internal
// caller that already resolved its own authorization can omit them and
// get the unscoped list — but routes/finance.js's own route always
// supplies them now (this session's own task: this endpoint used to
// let any authenticated user pull any student's payment history, which
// is the real gap being fixed here). Scoping goes through
// studentService.getStudent/assertCanViewStudent — the same
// tutor(+faculty-allocation)/hod/principal boundary as every other
// place student data is reachable, not reimplemented here.
async function listFeePaymentsForStudent(client, studentId, { actorUserId, actorRole } = {}) {
  if (actorRole !== undefined) {
    const student = await studentService.getStudent(client, studentId, { actorUserId, actorRole });
    if (student === null) {
      throw new FeePaymentStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
    }
  }
  return feePaymentRepository.findByStudentId(client, studentId);
}

async function listFeePayments(client, { limit, offset } = {}) {
  return feePaymentRepository.list(client, { limit, offset });
}

// Soft-delete only: feePaymentRepository has no hard-delete function
// at all, same shape as removeFeeStructure.
async function removeFeePayment(client, id, { userId } = {}) {
  const payment = await feePaymentRepository.softDelete(client, id);
  if (payment === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: payment.college_id,
    userId,
    action: 'fee_payment_removed',
    entity: 'fee_payments',
    entityId: id,
    metadata: null,
  });

  return payment;
}

// BusinessRules.md Finance — Scholarship eligibility (superseded): this
// income-threshold check is retained ONLY as one advisory input a
// Class Tutor may consult — never the eligibility outcome itself. It
// is not called from anywhere that records or acts on eligibility;
// recordScholarshipDecision below (the Tutor's real, audited decision)
// is the actual outcome BusinessRules.md now describes. Reads the
// student's own annual_income through StudentService, never
// studentRepository directly (CLAUDE.md rule 1/Architecture.md 2.5 —
// FinanceService owns scholarship eligibility, but a student record is
// StudentService's table), and the threshold through
// ConfigurationService category 'finance', key
// scholarshipIncomeThreshold — never a hardcoded number. A student
// with no annual_income on file is reported ineligible with a distinct
// reason rather than throwing: "we don't know this student's income"
// is a normal, expected state (income collection is optional), not an
// error the caller needs to handle specially.
async function checkScholarshipEligibility(client, collegeId, studentId, { actorUserId, actorRole } = {}) {
  const student = await studentService.getStudent(client, studentId, { actorUserId, actorRole });
  if (student === null) {
    throw new ScholarshipStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }

  if (student.annual_income === null || student.annual_income === undefined) {
    return {
      eligible: false, reason: 'no_income_on_file', annualIncome: null, threshold: null,
    };
  }

  const config = await configurationService.getConfiguration(client, { collegeId, category: 'finance' });
  const threshold = config ? config.configuration.scholarshipIncomeThreshold : undefined;
  if (threshold === undefined || threshold === null) {
    throw new ScholarshipThresholdNotConfiguredError(
      `college ${JSON.stringify(collegeId)} has no finance.scholarshipIncomeThreshold configured`,
    );
  }

  const annualIncome = Number(student.annual_income);
  const eligible = annualIncome < Number(threshold);
  return {
    eligible,
    reason: eligible ? 'below_threshold' : 'at_or_above_threshold',
    annualIncome,
    threshold: Number(threshold),
  };
}

// BusinessRules.md Scholarship: "the Class Tutor reviews students and
// marks each one Eligible or Not Eligible according to the
// institution's own policy... every eligibility decision is audited."
// This is that decision — the real outcome, unlike
// checkScholarshipEligibility above (advisory only). No hardcoded
// criteria enforced here either: eligible is whatever the Tutor
// decided, for whatever reason they recorded, per institution policy
// this codebase doesn't (and per BusinessRules.md, shouldn't) encode.
async function recordScholarshipDecision(client, studentId, {
  schemeName, eligible, reason, supportingDocumentId,
}, { actorUserId } = {}) {
  if (!schemeName) {
    throw new ScholarshipDecisionValidationError('schemeName is required');
  }
  if (typeof eligible !== 'boolean') {
    throw new ScholarshipDecisionValidationError('eligible must be a boolean');
  }

  const student = await studentService.getStudent(client, studentId);
  if (student === null) {
    throw new ScholarshipStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  const cls = student.class_id ? await classRepository.findById(client, student.class_id) : null;
  if (cls === null || cls.tutor_user_id !== actorUserId) {
    throw new ScholarshipDecisionNotTutorError(
      `user ${JSON.stringify(actorUserId)} is not the class tutor for student ${JSON.stringify(studentId)}`,
    );
  }

  const decision = await scholarshipDecisionRepository.create(client, {
    collegeId: student.college_id,
    studentId,
    schemeName,
    eligible,
    reason,
    supportingDocumentId,
    decidedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId,
    action: 'scholarship_decision_recorded',
    entity: 'scholarship_decisions',
    entityId: decision.id,
    metadata: { schemeName, eligible },
  });

  return decision;
}

async function listScholarshipDecisionsForStudent(client, studentId) {
  return scholarshipDecisionRepository.listForStudent(client, studentId);
}

// Same pragmatic hardcoded-limit convention reportService.js's own
// STUDENT_EXPORT_LIMIT already uses for "no real pagination story yet"
// reads — a college with more fee structures/payments than this gets a
// truncated summary, a flagged gap, not silently wrong totals.
const FEE_SUMMARY_LIMIT = 5000;

// finance_status_summary (AI tool, principal-only per AI-Governance.md
// — fee data is Restricted, and only principal's classification
// ceiling includes Restricted). Deliberately college-wide only, no
// class/department filter: nothing in this schema scopes a
// fee_structures row to one department (same reasoning
// submitFeeStructureApproval's own single-step, principal-only
// approverChain already gives), so there is no narrower "my scope" to
// resolve here the way attendance/marks/roster have one.
//
// A fee_payments row records one student's paid/not_paid outcome
// against one fee_structures row's amount — collected/outstanding is
// computed by joining the two in memory (financeRepository/
// feePaymentRepository have no aggregate SQL of their own), not by
// summing fee_structures.amount directly, since a single fee structure
// covers many students, each with (or without) their own payment
// record.
async function getFeeStatusSummary(client) {
  const [structures, payments] = await Promise.all([
    financeRepository.list(client, { limit: FEE_SUMMARY_LIMIT }),
    feePaymentRepository.list(client, { limit: FEE_SUMMARY_LIMIT }),
  ]);
  const structureById = new Map(structures.map((s) => [s.id, s]));

  let collectedAmount = 0;
  let outstandingAmount = 0;
  let paidCount = 0;
  let notPaidCount = 0;
  for (const payment of payments) {
    const structure = structureById.get(payment.fee_structure_id);
    if (structure === undefined) continue;
    const amount = Number(structure.amount);
    if (payment.status === 'paid') {
      collectedAmount += amount;
      paidCount += 1;
    } else {
      outstandingAmount += amount;
      notPaidCount += 1;
    }
  }

  return {
    feeStructuresCount: structures.length,
    paymentsRecordedCount: payments.length,
    paidCount,
    notPaidCount,
    collectedAmount: Math.round(collectedAmount * 100) / 100,
    outstandingAmount: Math.round(outstandingAmount * 100) / 100,
  };
}

module.exports = {
  FeeStructureValidationError,
  FeeStructureConflictError,
  FeeStructureClassNotFoundError,
  FeeStructureNotFoundError,
  FeeStructureNoPendingRequestError,
  FeePaymentValidationError,
  FeePaymentStatusError,
  FeePaymentStudentNotFoundError,
  FeePaymentFeeStructureNotFoundError,
  FeePaymentConflictError,
  ScholarshipStudentNotFoundError,
  ScholarshipThresholdNotConfiguredError,
  ScholarshipDecisionValidationError,
  ScholarshipDecisionNotTutorError,
  createFeeStructure,
  getFeeStructure,
  updateFeeStructure,
  removeFeeStructure,
  listFeeStructuresForClassAndYear,
  listFeeStructures,
  submitFeeStructureApproval,
  approveFeeStructure,
  rejectFeeStructure,
  markFeePayment,
  getFeePayment,
  listFeePaymentsForStudent,
  listFeePayments,
  removeFeePayment,
  checkScholarshipEligibility,
  recordScholarshipDecision,
  listScholarshipDecisionsForStudent,
  getFeeStatusSummary,
};
