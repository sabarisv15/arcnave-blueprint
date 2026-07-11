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

const ENCRYPTION_MAGIC = Buffer.from('ARCNAVEENC1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

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

function resolveInside(root, relativePath) {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('storage path escapes the configured root');
  }
  return absolutePath;
}

function resolveAbsolutePath(relativePath) {
  return resolveInside(config.documentStorageRoot, relativePath);
}

function resolveBackupPath(relativePath) {
  return resolveInside(config.documentBackupRoot, relativePath);
}

function encryptionKey() {
  return crypto.createHash('sha256').update(config.documentStorageEncryptionKey).digest();
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([ENCRYPTION_MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

function decryptBuffer(stored) {
  if (!stored.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC)) {
    return stored;
  }
  const ivStart = ENCRYPTION_MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), stored.subarray(ivStart, tagStart));
  decipher.setAuthTag(stored.subarray(tagStart, dataStart));
  return Buffer.concat([decipher.update(stored.subarray(dataStart)), decipher.final()]);
}

async function writeFile(relativePath, buffer) {
  const absolutePath = resolveAbsolutePath(relativePath);
  const backupPath = resolveBackupPath(relativePath);
  const stored = encryptBuffer(buffer);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, stored);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, stored);
}

async function readFile(relativePath) {
  const absolutePath = resolveAbsolutePath(relativePath);
  const backupPath = resolveBackupPath(relativePath);
  let stored;
  try {
    stored = await fs.readFile(absolutePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    stored = await fs.readFile(backupPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, stored);
  }
  return decryptBuffer(stored);
}

module.exports = {
  buildStoragePath,
  resolveAbsolutePath,
  resolveBackupPath,
  writeFile,
  readFile,
};
