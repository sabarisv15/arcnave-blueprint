'use strict';

// Business logic for Module 7 (Reports) — orchestrates other
// services' data into a ReportModel, hands it to a Generator for
// bytes, stores those bytes via DocumentService (never Storage
// directly — CLAUDE.md rule 2), then writes the outcome to
// generatedReportRepository (the ledger — ADR-018, not a domain
// repository this service "owns" the way FinanceService owns
// financeRepository).
//
// Flow per Architecture.md 2.6/ADR-008: ReportModel -> Generator ->
// bytes -> DocumentService -> Storage. ReportService itself never
// generates bytes and never touches storage — csvGenerator.generate
// and documentService.uploadDocument do those two jobs respectively.
//
// No separate audit_log entry here: generated_reports IS the audit
// record for this action (richer than a generic audit_log row —
// report_type/format/document_id/error_message), not something that
// also needs a duplicate entry alongside it (see ADR-018).
//
// Only one report type this slice — student_export, CSV only. Every
// other Generator (Excel/PDF/Word) and report type is deferred until a
// real screen asks for it, same restraint every other module's first
// slice applies to unbuilt capability.

const studentService = require('./studentService');
const documentService = require('./documentService');
const generatedReportRepository = require('../repositories/generatedReportRepository');
const csvGenerator = require('../generators/csvGenerator');

// Missing collegeId or actorUserId — nothing downstream (documentService,
// the ledger write) can proceed without either, same guard shape every
// other service's own top-level validation error gives.
class ReportValidationError extends Error {}

// students table columns worth exporting, real column names (not
// frontend/src/components/CsvExportModal.jsx's own stale MongoDB-era
// aliases — roll_number/name/etc. — since that modal already carries
// its own fallback-alias logic for exactly this old-vs-new mismatch).
// Its "Attendance" section (attendance %, blood_group, dob) is
// dropped entirely: none of those three exist as real students
// columns anywhere in this schema — not fabricated here either.
const STUDENT_EXPORT_COLUMNS = [
  ['roll_no', 'Roll Number'],
  ['full_name', 'Full Name'],
  ['gender', 'Gender'],
  ['entry_type', 'Entry Type'],
  ['emis_number', 'EMIS Number'],
  ['umis_number', 'UMIS Number'],
  ['email', 'Email Address'],
  ['phone', 'Phone Number'],
  ['parent_name', 'Parent Name'],
  ['parent_phone', 'Parent Phone'],
  ['address', 'Home Address'],
  ['pincode', 'Pincode'],
  ['mark_10th', '10th Mark'],
  ['mark_12th', '12th Mark'],
  ['mark_iti', 'ITI Mark'],
  ['accommodation', 'Accommodation'],
  ['club', 'Club'],
  ['internship', 'Internship'],
  ['career_plan', 'Career Plan'],
  ['notes', 'Notes'],
  ['license_number', 'License Number'],
  ['bike_number', 'Bike Number'],
];

// studentRepository.list has no "all, unpaginated" mode, and students
// has no class_id column anywhere in this schema yet (checked before
// assuming a class-scoped export was possible — TutorClass.jsx's own
// "student roster" has no real class filter to call either). A tenant
// with more students than this gets a truncated export — a flagged
// gap, not a real pagination story, same pragmatic hardcoded-limit
// shape PrincipalDashboard.jsx's own `?limit=200` fetches already use
// elsewhere in this codebase.
const STUDENT_EXPORT_LIMIT = 5000;

function buildStudentExportReportModel(students) {
  return {
    title: 'Student Export',
    columns: STUDENT_EXPORT_COLUMNS.map(([id, label]) => ({ id, label })),
    rows: students,
  };
}

async function generateStudentExportReport(client, { collegeId }, { actorUserId } = {}) {
  if (!collegeId || !actorUserId) {
    throw new ReportValidationError('collegeId and actorUserId are required');
  }

  try {
    const students = await studentService.listStudents(client, { limit: STUDENT_EXPORT_LIMIT });
    const csvBytes = csvGenerator.generate(buildStudentExportReportModel(students));

    // studentId omitted — this file belongs to no single student
    // (documents.student_id is nullable as of 1752800000000, exactly
    // for this case).
    const document = await documentService.uploadDocument(
      client,
      { collegeId, docType: 'generated_report', fileName: `student_export_${Date.now()}.csv`, mimeType: 'text/csv', fileBuffer: csvBytes },
      { actorUserId },
    );

    return await generatedReportRepository.create(client, {
      collegeId,
      requestedByUserId: actorUserId,
      reportType: 'student_export',
      format: 'csv',
      parameters: {},
      status: 'completed',
      documentId: document.id,
    });
  } catch (err) {
    if (err instanceof ReportValidationError) {
      throw err;
    }
    // Returned, not re-thrown: this whole function runs inside the
    // caller's request-scoped transaction (req.dbClient), and every
    // other route in this codebase rolls that transaction back
    // whenever a handler throws. Re-throwing here would undo the very
    // 'failed' row this catch block is trying to preserve — the
    // ledger write would commute with the request's own rollback and
    // vanish. Resolving with the failed row instead lets the
    // transaction commit normally; the caller checks `.status` to
    // know the outcome, same as markFeePayment's plain-return contract
    // for a result that isn't itself an error.
    return generatedReportRepository.create(client, {
      collegeId,
      requestedByUserId: actorUserId,
      reportType: 'student_export',
      format: 'csv',
      parameters: {},
      status: 'failed',
      errorMessage: err.message,
    });
  }
}

module.exports = {
  ReportValidationError,
  generateStudentExportReport,
};
