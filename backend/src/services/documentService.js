'use strict';

// Business logic for Module 6's `documents` table — validation, actor
// stamping, audit logging, and the storage read/write DocumentService
// alone is allowed to do (ADR-009 / CLAUDE.md rule 2). No route/UI
// consumes this yet (next slice) — AI tools and API routes alike must
// call through here, never documentRepository or fileStorage directly
// (CLAUDE.md rule 1).
//
// Core file identity (doc_type, file_name, storage_path, mime_type,
// file_size_bytes, student_id) is immutable once uploaded — no
// function here edits any of them after uploadDocument. Re-uploading a
// type is a new row (a new version, per the migration's own
// reasoning), never an edit of the old one. Only reviewDocument
// (status/verifiedBy/verifiedAt/remarks) ever mutates an existing row
// — narrower than financeService.updateFeeStructure's general
// whitelist, deliberately: nothing about an uploaded file's identity
// should change in place.
//
// removeDocument (soft-delete) never touches storage — deleted_at is
// set, the on-disk bytes are left alone. Architecture.md 2.5 names
// "retention" as a DocumentService responsibility; destroying the
// recoverable file the moment a row is soft-deleted would defeat that.
// documentRepository has no hard-delete function at all, so there is
// no branch here that could accidentally do so.

const PizZip = require('pizzip');
const documentRepository = require('../repositories/documentRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const fileStorage = require('../storage/fileStorage');
const templateMerger = require('../generators/templateMerger');

// Missing studentId, docType, fileName, mimeType, fileBuffer, or
// actorUserId — documents' own NOT NULL columns, plus the actor
// identity every write here needs (same reasoning
// attendanceService.markAttendance's/financeService.markFeePayment's
// own actor guards give).
class DocumentValidationError extends Error {}

// documents_student_id_fkey violated (Postgres 23503) — the given
// studentId doesn't exist.
class DocumentStudentNotFoundError extends Error {}

// reviewDocument was asked to set a status other than 'verified'/
// 'rejected' — the only two states anything transitions a document TO
// after upload (uploadDocument itself is the only path to 'uploaded',
// and it never accepts a caller-supplied status at all).
class DocumentReviewStatusError extends Error {}

const VALID_REVIEW_STATUSES = ['verified', 'rejected'];

// College Admin-uploaded college document templates (BusinessRules.md's
// College Admin resolution, item 2) -- stored exactly like any other
// document (same table, same storage_path, same DocumentService path,
// CLAUDE.md rule 2), never a second storage mechanism. Tagged apart
// from student files by doc_type/student_id alone: doc_type is always
// this literal value (not caller-suppliable the way uploadDocument's
// general docType is), student_id is always null (a template belongs
// to the college, not to any one student -- documents.student_id has
// been nullable since 1752800000000).
const TEMPLATE_DOC_TYPE = 'template';

// The one doc_type value CLAUDE.md rule 8 singles out — never used for
// identity, dedup, import, search, AI reasoning, or reporting.
// Exported here (not hardcoded independently elsewhere) so
// documentSearchService.js's own ingestion gate has one single source
// for the literal value, same reasoning TEMPLATE_DOC_TYPE already
// establishes for its own known-value constant.
const AADHAAR_DOC_TYPE = 'aadhaar';

// uploadTemplate rejects a non-.docx upload with this at upload time,
// rather than only discovering it later at mergeTemplate time (a
// corrupt/wrong-type template could otherwise sit in storage,
// undetected, until the first merge attempt).
class DocumentInvalidTemplateError extends Error {}

// Same structural check mergeTemplate's own PizZip(templateBuffer)
// already relies on to prove "this is a real .docx" — a .docx is a
// zip with a word/document.xml entry, not just any zip. Reused here,
// not duplicated: both call sites agree on what "valid .docx" means.
function assertValidDocxTemplate(fileBuffer) {
  let zip;
  try {
    zip = new PizZip(fileBuffer);
  } catch (err) {
    throw new DocumentInvalidTemplateError(`file is not a valid .docx: ${err.message}`);
  }
  if (!zip.file('word/document.xml')) {
    throw new DocumentInvalidTemplateError('file is not a valid .docx: missing word/document.xml');
  }
}

function assertValidReviewStatus(status) {
  if (!VALID_REVIEW_STATUSES.includes(status)) {
    throw new DocumentReviewStatusError(`status ${JSON.stringify(status)} is not a valid review outcome`);
  }
}

// A freshly uploaded document is always status='uploaded' (the DB
// default) — stricter than fee_structures.status, which does accept a
// caller-supplied value at create. No forged initial state here: only
// reviewDocument can ever move a document out of 'uploaded'.
//
// studentId is optional (documents.student_id is nullable as of
// 1752800000000) — omitted for files not owned by one student, e.g.
// ReportService's generated exports. Every existing per-student caller
// is unaffected; this only widens what's allowed.
async function uploadDocument(client, { collegeId, studentId, docType, fileName, mimeType, fileBuffer }, { actorUserId } = {}) {
  if (!docType || !fileName || !mimeType || !fileBuffer || !actorUserId) {
    throw new DocumentValidationError('docType, fileName, mimeType, fileBuffer, and actorUserId are required');
  }

  const storagePath = fileStorage.buildStoragePath({ collegeId, studentId, docType, fileName });
  await fileStorage.writeFile(storagePath, fileBuffer);

  let document;
  try {
    document = await documentRepository.create(client, {
      collegeId,
      studentId,
      docType,
      fileName,
      storagePath,
      mimeType,
      fileSizeBytes: fileBuffer.length,
      uploadedByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'documents_student_id_fkey') {
      throw new DocumentStudentNotFoundError(`studentId ${JSON.stringify(studentId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'document_uploaded',
    entity: 'documents',
    entityId: document.id,
    metadata: { docType },
  });

  return document;
}

// Thin wrapper over uploadDocument fixing docType/studentId to the
// template convention above -- every other field (fileName, mimeType,
// fileBuffer, actorUserId) and every validation/audit-logging path is
// the exact same uploadDocument this function delegates to, not a
// parallel implementation. No mimeType/content check that the upload
// is actually a .docx -- same restraint doc_type/mime_type already get
// everywhere else in this file (no CHECK, no enforcement at write
// time); mergeTemplate below is what actually needs a valid .docx, and
// it validates that at merge time, not here.
async function uploadTemplate(client, { collegeId, fileName, mimeType, fileBuffer }, { actorUserId } = {}) {
  if (fileBuffer) {
    assertValidDocxTemplate(fileBuffer);
  }
  return uploadDocument(
    client,
    { collegeId, studentId: null, docType: TEMPLATE_DOC_TYPE, fileName, mimeType, fileBuffer },
    { actorUserId },
  );
}

// null means no document exists with this id — not an error. A route
// (next slice) turns that into 404, same as every other getX in this
// codebase.
async function getDocument(client, id) {
  return documentRepository.findById(client, id);
}

// Architecture.md 2.5 names "download" as a DocumentService-owned
// responsibility — a real bytes-from-disk round-trip, not just the
// metadata row. Returns null if the document row doesn't exist (same
// not-found shape as getDocument); does not distinguish a missing row
// from a missing file on disk — both are a caller-facing 404 upstream,
// and a document row should never outlive its file under normal
// operation (nothing here deletes files independently of rows).
async function downloadDocument(client, id) {
  const document = await documentRepository.findById(client, id);
  if (document === null) {
    return null;
  }
  const buffer = await fileStorage.readFile(document.storage_path);
  return { document, buffer };
}

async function listDocumentsForStudent(client, studentId) {
  return documentRepository.findByStudentId(client, studentId);
}

async function getLatestDocumentForStudentAndType(client, studentId, docType) {
  return documentRepository.findLatestByStudentAndType(client, studentId, docType);
}

// The natural "what templates can I generate from" listing a picker
// UI needs — every non-deleted row tagged TEMPLATE_DOC_TYPE, same
// thin-wrapper shape listDocumentsForStudent already has.
async function listTemplates(client) {
  return documentRepository.findByDocType(client, TEMPLATE_DOC_TYPE);
}

// templateId names something that isn't actually a template (a
// student certificate, a generated report, etc.) — mergeDocumentTemplate
// refuses rather than silently merging arbitrary document bytes.
class DocumentNotATemplateError extends Error {}

// Composes the two pieces this slice's own build brief names
// separately (downloadDocument -> mergeTemplate) into the one real
// caller a route needs. The doc_type check runs BEFORE any disk read
// (findById, not downloadDocument, resolves the row first) -- checking
// identity first means a caller who passes some other document's id
// (a photo, a generated report) gets a clean DocumentNotATemplateError
// regardless of whatever bytes that row's storage_path happens to
// point at, rather than a raw disk-read error surfacing first for the
// wrong reason. Only once the row is confirmed to really be a
// template does this read its bytes (fileStorage.readFile, the same
// path downloadDocument itself uses -- no second storage mechanism).
// `fields` is whatever flat object the caller sends (e.g. a real
// student record) -- CLAUDE.md rule 9 still holds here exactly as
// templateMerger.js's own file comment describes: every value is
// inserted as literal text, never interpreted as instructions,
// regardless of where it came from.
async function mergeDocumentTemplate(client, templateId, fields) {
  const document = await documentRepository.findById(client, templateId);
  if (document === null) {
    return null;
  }
  if (document.doc_type !== TEMPLATE_DOC_TYPE) {
    throw new DocumentNotATemplateError(
      `document ${JSON.stringify(templateId)} is not a template (doc_type is ${JSON.stringify(document.doc_type)})`,
    );
  }

  const templateBuffer = await fileStorage.readFile(document.storage_path);
  const buffer = templateMerger.mergeTemplate(templateBuffer, fields);
  return { document, buffer };
}

// The only path that mutates an existing document row. Stamps
// verifiedByUserId/verifiedAt from the actor/clock, never
// caller-supplied — same "the actor is who did it right now" reasoning
// financeService.markFeePayment applies to markedByUserId.
async function reviewDocument(client, id, { status, remarks }, { actorUserId } = {}) {
  assertValidReviewStatus(status);

  const document = await documentRepository.update(client, id, {
    status,
    verifiedByUserId: actorUserId,
    verifiedAt: new Date(),
    remarks,
  });
  if (document === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: status === 'verified' ? 'document_verified' : 'document_rejected',
    entity: 'documents',
    entityId: id,
    metadata: null,
  });

  return document;
}

// Soft-delete only: documentRepository has no hard-delete function at
// all. softDelete's own WHERE guard means an already-deleted or
// missing id simply returns null (no error, no audit entry) — same
// idempotent shape financeService.removeFeeStructure already
// documents. Storage bytes are deliberately left untouched — see the
// file-level comment.
async function removeDocument(client, id, { userId } = {}) {
  const document = await documentRepository.softDelete(client, id);
  if (document === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId,
    action: 'document_removed',
    entity: 'documents',
    entityId: id,
    metadata: null,
  });

  return document;
}

async function listDocuments(client, { limit, offset } = {}) {
  return documentRepository.list(client, { limit, offset });
}

module.exports = {
  DocumentValidationError,
  DocumentStudentNotFoundError,
  DocumentReviewStatusError,
  TemplateMergeError: templateMerger.TemplateMergeError,
  DocumentNotATemplateError,
  DocumentInvalidTemplateError,
  TEMPLATE_DOC_TYPE,
  AADHAAR_DOC_TYPE,
  uploadDocument,
  uploadTemplate,
  mergeTemplate: templateMerger.mergeTemplate,
  mergeDocumentTemplate,
  listTemplates,
  getDocument,
  downloadDocument,
  listDocumentsForStudent,
  getLatestDocumentForStudentAndType,
  reviewDocument,
  removeDocument,
  listDocuments,
};
