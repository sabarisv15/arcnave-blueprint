# RESULT

## RAG slice (search_documents, closes Module 9)

Confirmed NIM has a real embeddings endpoint (`/v1/embeddings`,
OpenAI-compatible) — used it, not a second provider. Model:
`nvidia/nv-embedqa-e5-v5` (1024-dim, asymmetric query/passage
embeddings, purpose-built for retrieval).

### Files changed
- `docker-compose.yml` — `db` image `postgres:16` → `pgvector/pgvector:pg16` (drop-in, extension preinstalled).
- `backend/migrations/1753200000000_module-9-document-chunks-schema.js` — `ai_document_chunks` (pgvector, HNSW cosine index, RLS, no UPDATE/DELETE grant).
- `backend/src/repositories/aiDocumentChunkRepository.js` — new: `create`, `findByDocumentId`, `search` (cosine `<=>`, joined to `documents` to exclude soft-deleted).
- `backend/src/services/documentSearchService.js` — new Business Service: `ingestDocument` (chunk+embed), `searchDocuments` (embed query + row-level classification filter), doc_type→classification map, Aadhaar block.
- `backend/src/services/documentService.js` — gained `AADHAAR_DOC_TYPE` exported constant only (no auto-ingest hook — see below).
- `backend/src/services/aiClassificationAccess.js` — new: `ROLE_CLASSIFICATION_ACCESS` pulled out of `aiToolRegistry.js` so both the Policy Gate and `documentSearchService`'s row-level filter share one source.
- `backend/src/services/aiToolRegistry.js` — registers `search_documents` (L1/Internal, `allowedRoles` includes `staff`); sources the classification matrix from the new shared module.
- `backend/src/services/llmProvider.js` — new `embed(texts, {inputType})` + `EMBEDDING_DIMENSIONS`; shared transport factored into `postJson`.
- `backend/src/config.js` / `.env.example` — `NIM_EMBEDDING_MODEL`.
- `backend/tests/document-search-service.test.js` — new, 19 unit tests (chunking, classification mapping, Aadhaar block, mocked ingest/search).
- `docs/modules/Module-09-AI.md` — RAG slice section + live verification results + new Known Gaps.
- `.ai/TASK.md`, `.ai/RESULT.md` — this entry.

### A real bug caught and fixed mid-slice
First design auto-wired ingestion into `documentService.uploadDocument`
(best-effort, post-upload). This broke `reports.test.js`: report
exports are `text/csv`, so every report-generation test would silently
attempt a REAL embedding call whenever a real `NIM_API_KEY` happens to
be configured (as it now is) — a live network call hidden inside the
committed suite. It also left orphaned `ai_document_chunks` rows that
broke the test's hard-delete cleanup (`ai_document_chunks_document_id_fkey`
violation). Fixed by making `ingestDocument` explicit-only — never
auto-wired into `uploadDocument` — per the task's own "or a separate
backfill job" option. Confirmed with a from-scratch Docker rebuild +
full suite re-run: 520/520 clean.

### Live verification (one-off script, deleted after use)
Real Postgres (pgvector/HNSW) + real NIM embeddings:

| Proof | Result |
|---|---|
| Ingest real `birth_cert` (Confidential) + `scholarship_cert` (Restricted) docs | chunked, embedded, classified correctly |
| Ingest `aadhaar` doc | refused (`DocumentSearchAadhaarBlockedError`), zero chunks written |
| `search_documents` as principal, real query | 200, real chunks returned |
| `search_documents` as staff (Internal only) | 200, zero rows (no Internal content exists) |
| `search_documents` as hod vs principal, scholarship query | hod never sees the Restricted chunk; principal does |
| Cross-tenant isolation | College A's principal gets zero hits searching College B's distinctive content |
| Hostile-content-in-doc proof | forged boundary + "ignore previous instructions" round-trips as literal, inert `chunkText` |

### Verification
- Unit: 19/19 new tests (`document-search-service.test.js`).
- Full backend suite: **520/520**, `--test-concurrency=1`, real `NIM_API_KEY` present, migrated from a clean volume (proves the migration itself, not just an already-migrated DB).
- Docker Desktop → up, migrated, tested, torn down (`docker compose down`, volume removed once mid-session to clear orphaned data from the bug above, recreated clean).

### Flags
- No OCR pipeline — `ingestDocument` only supports `text/*` mime types (real documents are PDF/image; not indexable yet, not faked).
- Ingestion has no HTTP entry point — explicitly invoked only (a backfill CLI/route is a follow-up).
- No re-ingestion on document versioning — a re-uploaded doc_type's old chunks are neither cleaned up nor refreshed.
- `DOC_TYPE_CLASSIFICATION` (documentSearchService.js) is a conservative, code-level default, not sourced from BusinessRules.md — same "flag, revisit via ADR" posture as ADR-020.
- API key never printed/logged/committed.
