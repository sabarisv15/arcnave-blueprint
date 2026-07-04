'use strict';

// Local-disk storage for DocumentService (ADR-017). Pure fs helpers —
// no DB, no business logic, no permissions. Used only by
// documentService.js: ADR-009 gives DocumentService sole ownership of
// file storage, so nothing else in this codebase may require this
// module.
//
// Paths are always tenant-prefixed (Architecture.md 2.9) and never
// trust caller-supplied file names verbatim — sanitizeFileName strips
// anything that isn't alnum/dot/dash/underscore, closing the
// directory-traversal door (`../../etc/passwd`-style names) at the one
// place paths are built, not relied on elsewhere.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

function sanitizeFileName(fileName) {
  const base = path.basename(fileName || 'file');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// {collegeId}/{studentId}/{docType}/{timestamp}-{random}-{fileName} —
// the timestamp+random pair guarantees two versions of the same
// doc_type never collide on disk (documentRepository has no unique
// constraint blocking multiple uploads of the same type; storage_path
// must be equally collision-free, or the second upload would
// overwrite the first version's bytes on disk while the DB still had
// two distinct rows pointing at the same now-corrupted file).
//
// studentId is optional (documents.student_id is nullable as of
// 1752800000000, for non-student files like generated reports) — a
// missing studentId uses a fixed 'shared' path segment instead of
// path.posix.join silently coercing undefined to the string
// "undefined".
function buildStoragePath({ collegeId, studentId, docType, fileName }) {
  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  return path.posix.join(collegeId, studentId || 'shared', docType, `${unique}-${sanitizeFileName(fileName)}`);
}

function resolveAbsolutePath(relativePath) {
  return path.join(config.documentStorageRoot, relativePath);
}

async function writeFile(relativePath, buffer) {
  const absolutePath = resolveAbsolutePath(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
}

async function readFile(relativePath) {
  return fs.readFile(resolveAbsolutePath(relativePath));
}

module.exports = {
  buildStoragePath,
  writeFile,
  readFile,
};
