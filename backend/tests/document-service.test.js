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
const documentRepository = require('../src/repositories/documentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const fileStorage = require('../src/storage/fileStorage');
const documentService = require('../src/services/documentService');

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
});
