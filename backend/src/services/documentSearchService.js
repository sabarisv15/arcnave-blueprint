'use strict';

// Module 9 (AI) — RAG slice's Business Service. The search_documents AI
// tool (aiToolRegistry.js) wraps ONLY this file (CLAUDE.md rule 1: a
// thin wrapper over exactly one Business Service, no business logic of
// its own in the tool entry). This file owns two real jobs:
//
//   1. ingestDocument — chunk + embed an already-uploaded document's
//      text content. Deliberately NOT auto-wired into
//      documentService.uploadDocument: every real upload in this
//      codebase is binary (PDF/image), there is no OCR pipeline yet
//      (see below), and — concretely — making it automatic would mean
//      every document upload attempts a real network call to whatever
//      LLM provider happens to be configured in a given environment,
//      including inside the committed test suite (documents.test.js/
//      reports.test.js upload real files against live Postgres) —
//      exactly the "real API calls shouldn't run in CI" boundary this
//      project already draws elsewhere (see .ai/RESULT.md's live NIM
//      verification entry). ingestDocument is called explicitly
//      instead — a caller-invoked action (a backfill script, or a
//      future dedicated endpoint), same "or a separate backfill job"
//      option this slice's own task named. It is never called with raw
//      file bytes directly; it always goes back through
//      documentService.downloadDocument to get them (CLAUDE.md rule 2:
//      DocumentService remains the sole owner of file storage — this
//      file never touches fileStorage or documentRepository itself).
//   2. searchDocuments — embeds a caller's query, then runs a cosine-
//      distance nearest-chunks lookup scoped to the actor's own tenant
//      AND to the classifications aiClassificationAccess.
//      permittedClassifications(actor.role) actually allows — a
//      second, row-level filter independent of the Policy Gate's own
//      single tool-level classification check (AI-Governance.md §4).
//
// Retrieved chunk_text is exactly as untrusted as any other tool
// output (CLAUDE.md rule 9) — this file does nothing to that text
// beyond storing/retrieving it verbatim. aiToolRegistry's
// search_documents handler hands searchDocuments's return value
// straight into the same Context Builder / Prompt Safety Layer
// boundary every other tool result goes through (aiService.js's own
// pipeline) — nothing here "cleans" hostile text before embedding it,
// on the theory that embedding+cosine search is a similarity
// computation, not instruction execution; the untrusted-data boundary
// still gets applied exactly once, at the one place rule 9 already
// requires it, never twice and never skipped.
//
// No OCR pipeline exists yet (see the Module 6 documents migration's
// own file comment: "OCR/AI extraction... is Module 9 territory, not
// added here" — deferred again, not built by this slice either).
// ingestDocument therefore only supports documents whose mime_type is
// text-decodable (text/*) — a real, flagged gap, not a silently-faked
// OCR step: a PDF/image upload is refused, not mis-chunked from raw
// binary bytes decoded as if they were UTF-8 text.

const documentService = require('./documentService');
const aiClassificationAccess = require('./aiClassificationAccess');
const llmProvider = require('./llmProvider');
const auditLogRepository = require('../repositories/auditLogRepository');
const aiDocumentChunkRepository = require('../repositories/aiDocumentChunkRepository');

// searchDocuments given a missing/non-string query.
class DocumentSearchValidationError extends Error {}

// ingestDocument given a documentId that doesn't resolve to a real,
// non-deleted document (documentService.downloadDocument returned null).
class DocumentSearchNotFoundError extends Error {}

// CLAUDE.md rule 8, applied to this table's entire purpose (semantic
// search): an Aadhaar-doc_type document is never chunked/embedded
// here, full stop — refused at ingestion so no Aadhaar-derived
// embedding ever exists in this table to begin with, not filtered out
// later at query time.
class DocumentSearchAadhaarBlockedError extends Error {}

// No OCR pipeline exists yet (see file-level comment) — a document
// whose mime_type isn't text-decodable is refused, not mis-chunked
// from raw binary bytes.
class DocumentSearchUnsupportedContentError extends Error {}

// Mirrors doc_type's own "known values documented here, not enforced
// by the DB" convention (see the Module 6 documents migration) — this
// map is the one, single source of "how sensitive is this doc_type,"
// consulted only here, at ingestion time; nothing enforces it as a
// CHECK constraint, same restraint every other doc_type-adjacent rule
// in this schema already takes.
//
// Conservative defaults, not sourced from BusinessRules.md (which
// names no document-type-level classification) — same "flagged,
// revisit via ADR" posture ADR-020 already takes for
// ROLE_CLASSIFICATION_ACCESS. scholarship/income/community/bank
// documents carry financial or caste/income information
// (AI-Governance.md §4 already places "Fee details" at Restricted);
// transfer/birth/disability certs and a plain photo are Confidential
// (personal, not financial); a college template belongs to the
// college, not a student, so Internal.
const DOC_TYPE_CLASSIFICATION = {
  [documentService.TEMPLATE_DOC_TYPE]: 'Internal',
  scholarship_cert: 'Restricted',
  income_cert: 'Restricted',
  community_cert: 'Restricted',
  bank_passbook: 'Restricted',
  transfer_cert: 'Confidential',
  birth_cert: 'Confidential',
  disability_cert: 'Confidential',
  photo: 'Confidential',
};

// Any doc_type not named above gets this conservative default rather
// than the least-restrictive one — same reasoning
// aiClassificationAccess's own file comment gives for defaulting
// narrow, not broad.
const DEFAULT_CLASSIFICATION = 'Confidential';

function classifyDocType(docType) {
  if (docType === documentService.AADHAAR_DOC_TYPE) {
    throw new DocumentSearchAadhaarBlockedError(
      `doc_type ${JSON.stringify(docType)} is never ingested for AI search (CLAUDE.md rule 8)`,
    );
  }
  return DOC_TYPE_CLASSIFICATION[docType] || DEFAULT_CLASSIFICATION;
}

// A pure, fixed-size splitter — no sentence/paragraph awareness.
// Deliberately simple: nvidia/nv-embedqa-e5-v5's own max input is 512
// tokens (see llmProvider.js), and CHUNK_SIZE_CHARS is small enough to
// stay well under that for any real-world text without needing a
// token-counting dependency this slice doesn't otherwise need.
const CHUNK_SIZE_CHARS = 1000;

function chunkText(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const chunks = [];
  for (let i = 0; i < trimmed.length; i += CHUNK_SIZE_CHARS) {
    chunks.push(trimmed.slice(i, i + CHUNK_SIZE_CHARS));
  }
  return chunks;
}

// The only Business Service call this file makes to get file bytes —
// documentService.downloadDocument, never fileStorage/documentRepository
// directly (CLAUDE.md rule 2). Chunks are embedded and inserted one at
// a time (not batched into a single embed() call): deliberately simple
// over throughput for this first slice — a real backfill job batching
// many chunks per request is a follow-up, not built speculatively here.
async function ingestDocument(client, documentId, { actorUserId } = {}) {
  const result = await documentService.downloadDocument(client, documentId);
  if (result === null) {
    throw new DocumentSearchNotFoundError(`no document found with id ${JSON.stringify(documentId)}`);
  }
  const { document, buffer } = result;

  if (typeof document.mime_type !== 'string' || !document.mime_type.startsWith('text/')) {
    throw new DocumentSearchUnsupportedContentError(
      `document ${JSON.stringify(documentId)} has mime_type ${JSON.stringify(document.mime_type)}, which this `
      + 'slice cannot extract text from (no OCR pipeline exists yet — only text/* content is supported)',
    );
  }

  const classification = classifyDocType(document.doc_type);
  const chunks = chunkText(buffer.toString('utf8'));

  for (let i = 0; i < chunks.length; i += 1) {
    const [embedding] = await llmProvider.embed([chunks[i]], { inputType: 'passage' });
    await aiDocumentChunkRepository.create(client, {
      collegeId: document.college_id,
      documentId: document.id,
      chunkIndex: i,
      chunkText: chunks[i],
      classification,
      embedding,
    });
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: 'ai_document_ingested',
    entity: 'documents',
    entityId: document.id,
    metadata: { chunkCount: chunks.length, classification },
  });

  return { documentId: document.id, chunkCount: chunks.length, classification };
}

const DEFAULT_SEARCH_LIMIT = 5;

// The search_documents tool's own Business Service call. Row-level
// classification filtering happens HERE, not in aiToolRegistry's tool
// entry (CLAUDE.md rule 1: no business logic in the tool wrapper
// itself) — an actor with no permitted classifications at all (an
// unrecognized role) gets an empty result set, not an error; searching
// and finding nothing is not a failure the way a Policy Gate rejection
// is.
async function searchDocuments(client, { query, limit } = {}, actor) {
  if (!query || typeof query !== 'string') {
    throw new DocumentSearchValidationError('query is required and must be a non-empty string');
  }

  const classifications = aiClassificationAccess.permittedClassifications(actor.role);
  const [queryEmbedding] = await llmProvider.embed([query], { inputType: 'query' });
  const rows = await aiDocumentChunkRepository.search(client, {
    collegeId: actor.collegeId,
    classifications,
    embedding: queryEmbedding,
    limit: limit || DEFAULT_SEARCH_LIMIT,
  });

  return rows.map((row) => ({
    documentId: row.document_id,
    docType: row.doc_type,
    fileName: row.file_name,
    classification: row.classification,
    chunkText: row.chunk_text,
    distance: row.distance,
  }));
}

module.exports = {
  DocumentSearchValidationError,
  DocumentSearchNotFoundError,
  DocumentSearchAadhaarBlockedError,
  DocumentSearchUnsupportedContentError,
  chunkText,
  classifyDocType,
  ingestDocument,
  searchDocuments,
};
