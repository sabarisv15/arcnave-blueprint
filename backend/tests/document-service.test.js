'use strict';

// Unit tests for DocumentService's business-logic paths — no live
// Postgres, no real filesystem: documentRepository, auditLogRepository,
// and fileStorage are stubbed via node:test's built-in mock, same
// technique as finance-service.test.js (works because documentService
// always calls e.g. `documentRepository.create(...)` as a fresh
// property lookup, never a destructured local).
//
// What's deliberately NOT here: a real documents_student_id_fkey
// violation reaching DocumentStudentNotFoundError through a real
// Postgres constraint, or a real disk write/read round-trip through
// fileStorage — both already live-verified (documentRepository against
// a real DB in 9b7d779; fileStorage against the real filesystem via a
// throwaway script this slice, per .ai/RESULT.md). This file trusts
// that grounding rather than re-running a live DB/filesystem for a
// service layer that adds no new SQL or fs calls of its own beyond
// what those two already prove.

const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const documentRepository = require('../src/repositories/documentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const fileStorage = require('../src/storage/fileStorage');
const templateMerger = require('../src/generators/templateMerger');
const documentService = require('../src/services/documentService');
const visibilityService = require('../src/services/visibilityService');
const documentCategoryService = require('../src/services/documentCategoryService');
const academicYearService = require('../src/services/academicYearService');

function buildFakeDocxBuffer() {
  const zip = new PizZip();
  zip.file('word/document.xml', '<xml>hi</xml>');
  return zip.generate({ type: 'nodebuffer' });
}

function mockHappyPath(t, { createResult, updateResult } = {}) {
  const buildPathMock = t.mock.method(fileStorage, 'buildStoragePath', () => 'c1/s1/aadhaar/123-file.pdf');
  const writeFileMock = t.mock.method(fileStorage, 'writeFile', async () => {});
  const createMock = t.mock.method(documentRepository, 'create', async (client, fields) => (
    createResult || { id: 'doc-1', college_id: fields.collegeId, status: 'uploaded' }
  ));
  const updateMock = t.mock.method(documentRepository, 'update', async (client, id, fields) => (
    updateResult === undefined ? { id, college_id: 'c1', ...fields } : updateResult
  ));
  const softDeleteMock = t.mock.method(documentRepository, 'softDelete', async (client, id) => ({ id, college_id: 'c1', deleted_at: new Date() }));
  const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
  t.after(() => {
    buildPathMock.mock.restore();
    writeFileMock.mock.restore();
    createMock.mock.restore();
    updateMock.mock.restore();
    softDeleteMock.mock.restore();
    auditMock.mock.restore();
  });
  return { buildPathMock, writeFileMock, createMock, updateMock, softDeleteMock, auditMock };
}

test('DocumentService validation, actor stamping, and audit logging (no DB, no filesystem)', async (t) => {
  await t.test('uploadDocument rejects missing required fields without touching storage or the DB', async () => {
    const { buildPathMock, createMock } = mockHappyPath(t);

    await assert.rejects(
      () => documentService.uploadDocument({}, { collegeId: 'c1' }, { actorUserId: 'u1' }),
      documentService.DocumentValidationError,
    );
    assert.equal(buildPathMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('uploadDocument rejects a missing actorUserId', async () => {
    mockHappyPath(t);
    await assert.rejects(
      () => documentService.uploadDocument({}, {
        collegeId: 'c1', studentId: 's1', docType: 'aadhaar', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, {}),
      documentService.DocumentValidationError,
    );
  });

  await t.test('uploadDocument never accepts a caller-supplied status — always writes through the repository default', async () => {
    const { createMock } = mockHappyPath(t);

    await documentService.uploadDocument({}, {
      collegeId: 'c1', studentId: 's1', docType: 'aadhaar', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('hello'), status: 'verified',
    }, { actorUserId: 'u1' });

    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.status, undefined, 'status must never be forwarded from the caller into create()');
    assert.equal(fields.fileSizeBytes, Buffer.from('hello').length);
  });

  await t.test('uploadDocument writes bytes to storage before creating the row', async () => {
    const { writeFileMock, createMock } = mockHappyPath(t);

    await documentService.uploadDocument({}, {
      collegeId: 'c1', studentId: 's1', docType: 'photo', fileName: 'p.jpg', mimeType: 'image/jpeg', fileBuffer: Buffer.from('img'),
    }, { actorUserId: 'u1' });

    assert.equal(writeFileMock.mock.callCount(), 1);
    assert.equal(createMock.mock.callCount(), 1);
    assert.ok(writeFileMock.mock.calls[0].arguments[1].equals(Buffer.from('img')));
  });

  await t.test('uploadDocument maps a documents_student_id_fkey violation to DocumentStudentNotFoundError', async () => {
    mockHappyPath(t);
    const createMock = t.mock.method(documentRepository, 'create', async () => {
      const err = new Error('violates foreign key constraint');
      err.code = '23503';
      err.constraint = 'documents_student_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => documentService.uploadDocument({}, {
        collegeId: 'c1', studentId: 'bogus', docType: 'aadhaar', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentStudentNotFoundError,
    );
  });

  await t.test('reviewDocument rejects a status other than verified/rejected', async () => {
    mockHappyPath(t);
    await assert.rejects(
      () => documentService.reviewDocument({}, 'doc-1', { status: 'uploaded' }, { actorUserId: 'u2' }),
      documentService.DocumentReviewStatusError,
    );
  });

  await t.test('reviewDocument accepts verified and rejected, stamping the actor and a timestamp, never the caller\'s', async () => {
    const { updateMock } = mockHappyPath(t);

    await documentService.reviewDocument({}, 'doc-1', { status: 'verified', remarks: 'looks good' }, { actorUserId: 'u2' });
    const [, , fields] = updateMock.mock.calls[0].arguments;
    assert.equal(fields.status, 'verified');
    assert.equal(fields.verifiedByUserId, 'u2');
    assert.ok(fields.verifiedAt instanceof Date);
    assert.equal(fields.remarks, 'looks good');

    await documentService.reviewDocument({}, 'doc-2', { status: 'rejected', remarks: 'blurry' }, { actorUserId: 'u3' });
    const [, , fields2] = updateMock.mock.calls[1].arguments;
    assert.equal(fields2.status, 'rejected');
    assert.equal(fields2.verifiedByUserId, 'u3');
  });

  await t.test('reviewDocument returns null (no audit entry) when the id doesn\'t match a live row', async () => {
    const { auditMock } = mockHappyPath(t, { updateResult: null });
    const result = await documentService.reviewDocument({}, 'missing', { status: 'verified' }, { actorUserId: 'u2' });
    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeDocument soft-deletes without touching fileStorage at all', async () => {
    const { softDeleteMock } = mockHappyPath(t);
    const writeFileMock = fileStorage.writeFile;
    const readFileMock = t.mock.method(fileStorage, 'readFile', async () => { throw new Error('should not be called'); });
    t.after(() => readFileMock.mock.restore());

    const result = await documentService.removeDocument({}, 'doc-1', { userId: 'u2' });
    assert.equal(softDeleteMock.mock.callCount(), 1);
    assert.equal(readFileMock.mock.callCount(), 0);
    assert.ok(result.deleted_at);
  });

  await t.test('removeDocument is a no-op (no audit entry) on an already-deleted/missing id', async () => {
    mockHappyPath(t);
    const softDeleteMock = t.mock.method(documentRepository, 'softDelete', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      softDeleteMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await documentService.removeDocument({}, 'missing', { userId: 'u2' });
    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('downloadDocument returns null without calling fileStorage.readFile when the row doesn\'t exist', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => null);
    const readFileMock = t.mock.method(fileStorage, 'readFile', async () => Buffer.from('should not run'));
    t.after(() => {
      findByIdMock.mock.restore();
      readFileMock.mock.restore();
    });

    const result = await documentService.downloadDocument({}, 'missing');
    assert.equal(result, null);
    assert.equal(readFileMock.mock.callCount(), 0);
  });

  await t.test('downloadDocument reads bytes from storage using the row\'s storage_path', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({ id: 'doc-1', storage_path: 'c1/s1/aadhaar/x.pdf' }));
    const readFileMock = t.mock.method(fileStorage, 'readFile', async (relativePath) => Buffer.from(`bytes-for-${relativePath}`));
    t.after(() => {
      findByIdMock.mock.restore();
      readFileMock.mock.restore();
    });

    const result = await documentService.downloadDocument({}, 'doc-1');
    assert.equal(result.document.id, 'doc-1');
    assert.equal(result.buffer.toString(), 'bytes-for-c1/s1/aadhaar/x.pdf');
  });

  await t.test('uploadTemplate rejects a non-.docx buffer at upload time, without touching storage or the DB', async () => {
    const { buildPathMock, createMock } = mockHappyPath(t);

    await assert.rejects(
      () => documentService.uploadTemplate({}, {
        collegeId: 'c1', fileName: 'not-a-docx.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileBuffer: Buffer.from('plain text, not a zip'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentInvalidTemplateError,
    );
    assert.equal(buildPathMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('uploadTemplate rejects a real zip that isn\'t a .docx (no word/document.xml)', async () => {
    mockHappyPath(t);
    const zip = new PizZip();
    zip.file('not-a-word-doc.txt', 'hello');
    const plainZipBuffer = zip.generate({ type: 'nodebuffer' });

    await assert.rejects(
      () => documentService.uploadTemplate({}, {
        collegeId: 'c1', fileName: 'fake.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileBuffer: plainZipBuffer,
      }, { actorUserId: 'u1' }),
      documentService.DocumentInvalidTemplateError,
    );
  });

  await t.test('uploadTemplate accepts a real .docx (valid zip with word/document.xml)', async () => {
    const { createMock } = mockHappyPath(t);

    await documentService.uploadTemplate({}, {
      collegeId: 'c1', fileName: 'real.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileBuffer: buildFakeDocxBuffer(),
    }, { actorUserId: 'u1' });

    assert.equal(createMock.mock.callCount(), 1);
  });

  await t.test('uploadInstitutionalDocument rejects a missing title, without touching storage or the DB', async () => {
    const { buildPathMock, createMock } = mockHappyPath(t);

    await assert.rejects(
      () => documentService.uploadInstitutionalDocument({}, {
        collegeId: 'c1', categoryId: 'cat-1', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentValidationError,
    );
    assert.equal(buildPathMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('uploadInstitutionalDocument rejects a categoryId that does not resolve to a real category', async () => {
    const { createMock } = mockHappyPath(t);
    const getCategoryMock = t.mock.method(documentCategoryService, 'getCategory', async () => null);
    t.after(() => getCategoryMock.mock.restore());

    await assert.rejects(
      () => documentService.uploadInstitutionalDocument({}, {
        collegeId: 'c1', title: 'Notice', categoryId: 'bogus', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentCategoryNotFoundError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('uploadInstitutionalDocument resolves category/active-year, forces studentId to null, and derives docType from the category slug', async () => {
    const { createMock } = mockHappyPath(t);
    const getCategoryMock = t.mock.method(documentCategoryService, 'getCategory', async () => ({ id: 'cat-1', slug: 'circular', name: 'Circulars' }));
    const getActiveYearMock = t.mock.method(academicYearService, 'getActiveAcademicYear', async () => ({ id: 'year-1' }));
    t.after(() => { getCategoryMock.mock.restore(); getActiveYearMock.mock.restore(); });

    await documentService.uploadInstitutionalDocument({}, {
      collegeId: 'c1', title: 'Diwali holiday notice', categoryId: 'cat-1', classId: 'class-1', fileName: 'notice.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
    }, { actorUserId: 'u1' });

    assert.equal(createMock.mock.callCount(), 1);
    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.studentId, null);
    assert.equal(fields.classId, 'class-1');
    assert.equal(fields.docType, 'circular');
    assert.equal(fields.title, 'Diwali holiday notice');
    assert.equal(fields.categoryId, 'cat-1');
    assert.equal(fields.academicYearId, 'year-1', 'omitted academicYearId must default to the college\'s active year');
  });

  await t.test('uploadInstitutionalDocument leaves academicYearId null when no year is Active', async () => {
    const { createMock } = mockHappyPath(t);
    const getCategoryMock = t.mock.method(documentCategoryService, 'getCategory', async () => ({ id: 'cat-1', slug: 'circular', name: 'Circulars' }));
    const getActiveYearMock = t.mock.method(academicYearService, 'getActiveAcademicYear', async () => null);
    t.after(() => { getCategoryMock.mock.restore(); getActiveYearMock.mock.restore(); });

    await documentService.uploadInstitutionalDocument({}, {
      collegeId: 'c1', title: 'Notice', categoryId: 'cat-1', fileName: 'notice.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
    }, { actorUserId: 'u1' });

    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.academicYearId, null);
  });

  await t.test('listInstitutionalDocuments delegates to documentRepository.findInstitutional with the given filters', async () => {
    const findInstitutionalMock = t.mock.method(documentRepository, 'findInstitutional', async () => [{ id: 'doc-1' }]);
    t.after(() => findInstitutionalMock.mock.restore());

    const result = await documentService.listInstitutionalDocuments({}, { categoryId: 'cat-1', academicYearId: 'year-1', departmentId: 'dept-1', search: 'notice' });

    assert.equal(findInstitutionalMock.mock.callCount(), 1);
    assert.deepEqual(findInstitutionalMock.mock.calls[0].arguments[1], {
      docType: undefined, classId: undefined, categoryId: 'cat-1', academicYearId: 'year-1', departmentId: 'dept-1', search: 'notice',
    });
    assert.deepEqual(result, [{ id: 'doc-1' }]);
  });

  await t.test('mergeDocumentTemplate persists the merged bytes as a new document via uploadDocument', async () => {
    const { buildPathMock, writeFileMock, createMock } = mockHappyPath(t);
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({
      id: 'tmpl-1', doc_type: documentService.TEMPLATE_DOC_TYPE, college_id: 'c1', file_name: 'cert.docx', storage_path: 'c1/templates/cert.docx',
    }));
    const readFileMock = t.mock.method(fileStorage, 'readFile', async () => Buffer.from('template-bytes'));
    const mergeMock = t.mock.method(templateMerger, 'mergeTemplate', () => Buffer.from('merged-bytes'));
    t.after(() => {
      findByIdMock.mock.restore();
      readFileMock.mock.restore();
      mergeMock.mock.restore();
    });

    const result = await documentService.mergeDocumentTemplate({}, 'tmpl-1', { name: 'Jane' }, { actorUserId: 'u1' });

    assert.equal(createMock.mock.callCount(), 1);
    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.docType, 'merged_document');
    assert.equal(fields.fileName, 'merged-cert.docx');
    assert.equal(buildPathMock.mock.callCount(), 1);
    assert.equal(writeFileMock.mock.callCount(), 1);
    assert.ok(writeFileMock.mock.calls[0].arguments[1].equals(Buffer.from('merged-bytes')));
    assert.ok(result.buffer.equals(Buffer.from('merged-bytes')));
  });

  await t.test('mergeDocumentTemplate returns null without persisting anything when the id doesn\'t exist', async () => {
    const { createMock } = mockHappyPath(t);
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => null);
    t.after(() => findByIdMock.mock.restore());

    const result = await documentService.mergeDocumentTemplate({}, 'missing', {}, { actorUserId: 'u1' });
    assert.equal(result, null);
    assert.equal(createMock.mock.callCount(), 0);
  });
});

// assertCanViewDocument (this session's own task): the one shared gate
// GET /documents/:id, .../download, .../ocr, and GET /documents?student_id=
// all now run through. student_id present delegates to
// visibilityService; student_id null branches on doc_type/ownership.
test('DocumentService.assertCanViewDocument (no DB)', async (t) => {
  await t.test('a student-linked document delegates to visibilityService.assertCanViewStudent', async () => {
    const viewMock = t.mock.method(visibilityService, 'assertCanViewStudent', async () => {});
    t.after(() => viewMock.mock.restore());

    await documentService.assertCanViewDocument(
      {},
      { id: 'doc-1', student_id: 'student-1', doc_type: 'marksheet' },
      { actorUserId: 'tutor-u1', actorRole: 'staff' },
    );
    assert.equal(viewMock.mock.callCount(), 1);
    assert.equal(viewMock.mock.calls[0].arguments[1], 'student-1');
  });

  await t.test('a student-linked document rejects a caller outside the student\'s scope (staff from a different class)', async () => {
    const viewMock = t.mock.method(visibilityService, 'assertCanViewStudent', async () => {
      throw new visibilityService.VisibilityForbiddenError('nope');
    });
    t.after(() => viewMock.mock.restore());

    await assert.rejects(
      () => documentService.assertCanViewDocument(
        {},
        { id: 'doc-1', student_id: 'student-1', doc_type: 'marksheet' },
        { actorUserId: 'other-staff-u2', actorRole: 'staff' },
      ),
      documentService.DocumentNotAuthorizedError,
    );
  });

  await t.test('a template (student_id null) is readable by any authenticated role', async () => {
    await documentService.assertCanViewDocument(
      {},
      {
        id: 'tpl-1', student_id: null, doc_type: documentService.TEMPLATE_DOC_TYPE, uploaded_by_user_id: 'admin-1',
      },
      { actorUserId: 'staff-u1', actorRole: 'staff' },
    );
    // No assertion needed beyond "did not throw" — reaching here is the test.
  });

  await t.test('a generated report (student_id null, not a template) is readable by the principal', async () => {
    await documentService.assertCanViewDocument(
      {},
      {
        id: 'report-1', student_id: null, doc_type: 'merged_document', uploaded_by_user_id: 'staff-u1',
      },
      { actorUserId: 'principal-u1', actorRole: 'principal' },
    );
  });

  await t.test('a generated report (student_id null, not a template) is readable by the user who generated it', async () => {
    await documentService.assertCanViewDocument(
      {},
      {
        id: 'report-1', student_id: null, doc_type: 'merged_document', uploaded_by_user_id: 'staff-u1',
      },
      { actorUserId: 'staff-u1', actorRole: 'staff' },
    );
  });

  await t.test('a generated report (student_id null, not a template) is rejected for an unrelated staff member — not broadly readable', async () => {
    await assert.rejects(
      () => documentService.assertCanViewDocument(
        {},
        {
          id: 'report-1', student_id: null, doc_type: 'merged_document', uploaded_by_user_id: 'staff-u1',
        },
        { actorUserId: 'other-staff-u2', actorRole: 'staff' },
      ),
      documentService.DocumentNotAuthorizedError,
    );
  });
});
