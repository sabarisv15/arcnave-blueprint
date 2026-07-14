'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const documentService = require('../services/documentService');
const ocrService = require('../services/ocrService');
const visibilityService = require('../services/visibilityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not a shared util,
// same reasoning every other routes/*.js file already gives.
// college_id is deliberately absent: always req.collegeId, never the
// request body. file_base64 is upload-only (see .ai/TASK.md — no
// multipart parser exists yet; a base64 string in the same JSON body
// every other route already uses needs no new dependency).
const UPLOAD_BODY_FIELDS = [
  ['student_id', 'studentId'],
  ['doc_type', 'docType'],
  ['file_name', 'fileName'],
  ['mime_type', 'mimeType'],
];

const REVIEW_BODY_FIELDS = [
  ['status', 'status'],
  ['remarks', 'remarks'],
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

// Strips CR/LF and double-quotes before a value goes into a
// Content-Disposition header — file_name is caller-supplied at upload
// time, and an unsanitized value there is a header-injection vector
// (OWASP CRLF injection / response splitting), not just a display
// nicety.
function safeHeaderFileName(fileName) {
  return String(fileName).replace(/[\r\n"]/g, '');
}

function mapDocumentServiceError(err, res) {
  if (err instanceof documentService.DocumentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentReviewStatusError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentNotATemplateError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentInvalidTemplateError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.TemplateMergeError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function mapOcrServiceError(err, res) {
  if (err instanceof ocrService.OcrValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof ocrService.OcrDocumentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  return false;
}

function createDocumentsRouter() {
  const router = express.Router();

  // RBAC is the same deliberately conservative default
  // students.js/staff.js/finance.js all use, not a final decision —
  // BusinessRules.md names no specific actor for document upload/
  // verification. requirePermission('documents.upload'/'documents.review'/
  // 'documents.delete') (mapped to ['principal'] in
  // middleware/permissions.js) gates every write; requireAuth gates
  // every read. Revisit once a real role model names who may upload/
  // verify a student's documents (most likely the class tutor, per
  // BusinessRules.md's Staff section — not assumed here) — that's a
  // new permission mapping at that point, not a new mechanism.

  // A route-level body-size limit, not a global one: base64 adds ~33%
  // overhead over raw bytes, and this is the only endpoint in the app
  // that needs headroom above express.json()'s default 100kb.
  router.post('/documents', requirePermission('documents.upload'), express.json({ limit: '15mb' }), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { file_base64: fileBase64 } = req.body || {};
    if (typeof fileBase64 !== 'string' || fileBase64.length === 0) {
      res.status(400).json({ detail: 'file_base64 is required' });
      return;
    }

    try {
      const document = await documentService.uploadDocument(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToFields(req.body || {}, UPLOAD_BODY_FIELDS), fileBuffer: Buffer.from(fileBase64, 'base64') },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // Template-fill: upload is college_admin only (BusinessRules.md's
  // College Admin resolution, item 2 — "uploading/managing college
  // document templates"), via requirePermission('documents.templates.upload')
  // (mapped to ['college_admin']), unlike the principal-mapped
  // permissions every other write on this router uses. Calls
  // uploadTemplate specifically
  // (not the general POST /documents above), which fixes
  // doc_type='template'/student_id=null structurally — a caller here
  // cannot forge a template row with a student_id, or a student
  // document silently tagged as a template.
  router.post('/documents/templates', requirePermission('documents.templates.upload'), express.json({ limit: '15mb' }), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { file_base64: fileBase64, file_name: fileName, mime_type: mimeType } = req.body || {};
    if (typeof fileBase64 !== 'string' || fileBase64.length === 0) {
      res.status(400).json({ detail: 'file_base64 is required' });
      return;
    }

    try {
      const document = await documentService.uploadTemplate(
        req.dbClient,
        { collegeId: req.collegeId, fileName, mimeType, fileBuffer: Buffer.from(fileBase64, 'base64') },
        { actorUserId: req.jwtClaims.sub },
      );
      res.status(201).json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth, not college_admin-only: picking a template to
  // generate a document from (the student-profile "Generate from
  // template" caller) is a read, needed by whoever is looking at a
  // student's profile — same "reads are requireAuth, writes are the
  // gated action" split every other router in this codebase already
  // draws.
  router.get('/documents/templates', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const templates = await documentService.listTemplates(req.dbClient);
    res.json(templates);
  }));

  // The one real caller this slice names: merge arbitrary
  // caller-supplied fields (e.g. a real student record) into a stored
  // template, persist the merged bytes as a new document (via
  // mergeDocumentTemplate -> uploadDocument), and stream the same
  // bytes back in the response. No extra visibility gate on the input
  // template needed: mergeDocumentTemplate already refuses anything
  // whose doc_type isn't TEMPLATE_DOC_TYPE (DocumentNotATemplateError),
  // and templates are open to any authenticated user to read/use (this
  // session's own task) — same rule GET /documents/:id enforces for a
  // template row directly. The generated output's ownership is
  // established structurally, not by an extra check here: uploadDocument
  // stamps uploaded_by_user_id from actorUserId, which is exactly what
  // documentService.assertCanViewDocument's "generated report" branch
  // later gates that same output's own reads on (principal or the
  // actor who generated it).
  router.post('/documents/:id/merge', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await documentService.mergeDocumentTemplate(
        req.dbClient,
        req.params.id,
        (req.body && req.body.fields) || {},
        { actorUserId: req.jwtClaims.sub },
      );
      if (result === null) {
        res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.set('Content-Disposition', `attachment; filename="${safeHeaderFileName(result.document.file_name)}"`);
      res.send(result.buffer);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/documents/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const document = await documentService.getDocument(req.dbClient, req.params.id);
    if (document === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    try {
      await documentService.assertCanViewDocument(req.dbClient, document, {
        actorUserId: req.jwtClaims.sub, actorRole: req.jwtClaims.role,
      });
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
    res.json(document);
  }));

  // Real bytes, not JSON — Architecture.md 2.5 names "download" as a
  // DocumentService responsibility, and a caller asking to download a
  // file wants the file, not a base64-wrapped envelope. Metadata is
  // fetched first (getDocument) so the visibility check runs before any
  // disk read — an unauthorized caller never triggers
  // fileStorage.readFile at all, not just gets the bytes withheld after
  // the fact.
  router.get('/documents/:id/download', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const document = await documentService.getDocument(req.dbClient, req.params.id);
    if (document === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    try {
      await documentService.assertCanViewDocument(req.dbClient, document, {
        actorUserId: req.jwtClaims.sub, actorRole: req.jwtClaims.role,
      });
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
    const result = await documentService.downloadDocument(req.dbClient, req.params.id);
    if (result === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.set('Content-Type', result.document.mime_type);
    res.set('Content-Disposition', `attachment; filename="${safeHeaderFileName(result.document.file_name)}"`);
    res.send(result.buffer);
  }));

  router.post('/documents/:id/ocr', requirePermission('documents.ocr.run'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await ocrService.processDocument(req.dbClient, req.params.id, { actorUserId: req.jwtClaims.sub });
      res.status(201).json(result);
    } catch (err) {
      if (mapOcrServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/documents/:id/ocr', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const document = await documentService.getDocument(req.dbClient, req.params.id);
    if (document === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    try {
      await documentService.assertCanViewDocument(req.dbClient, document, {
        actorUserId: req.jwtClaims.sub, actorRole: req.jwtClaims.role,
      });
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
    const results = await ocrService.listForDocument(req.dbClient, req.params.id);
    res.json(results);
  }));

  // student_id is required — the "list-by-student" endpoint this
  // slice needs, not a general/unscoped list, same restraint
  // finance.js's own GET /finance/fee-payments documents for the
  // identical shape. Scoped via visibilityService directly against the
  // studentId (this session's own task: this route used to let any
  // authenticated user pull any student's document list) — the same
  // tutor(+faculty-allocation)/hod/principal boundary as every other
  // student-data read.
  router.get('/documents', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { student_id: studentId } = req.query;
    if (!studentId) {
      res.status(400).json({ detail: 'student_id query parameter is required' });
      return;
    }
    try {
      await visibilityService.assertCanViewStudent(req.dbClient, studentId, {
        actorUserId: req.jwtClaims.sub, actorRole: req.jwtClaims.role,
      });
    } catch (err) {
      if (err instanceof visibilityService.VisibilityForbiddenError) {
        res.status(403).json({ detail: err.message });
        return;
      }
      throw err;
    }
    const documents = await documentService.listDocumentsForStudent(req.dbClient, studentId);
    res.json(documents);
  }));

  router.post('/documents/:id/review', requirePermission('documents.review'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const document = await documentService.reviewDocument(
        req.dbClient,
        req.params.id,
        bodyToFields(req.body || {}, REVIEW_BODY_FIELDS),
        { actorUserId: req.jwtClaims.sub },
      );
      if (document === null) {
        res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/documents/:id', requirePermission('documents.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const document = await documentService.removeDocument(req.dbClient, req.params.id, { userId: req.jwtClaims.sub });
    if (document === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createDocumentsRouter;
