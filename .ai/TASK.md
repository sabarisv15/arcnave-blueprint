# TASK

## Objective (Module 9 — RAG, closes Module 9)
pgvector-backed document retrieval, gated same as every other tool:
Policy Gate + untrusted-forever (never "sanitize then trust").

## Decisions
- New table `ai_document_chunks` (college_id, document_id FK ->
  documents, chunk_text, embedding vector, classification) — migration.
- Ingestion: chunk + embed on DocumentService upload (or a separate
  backfill job) — check DocumentService first, don't bypass rule 2.
- New L1 tool `search_documents`: embeds query, cosine-distance search
  scoped to college_id + classification the actor may see, returns
  chunks through existing Context Builder/Prompt Safety — retrieved
  text tagged untrusted at use, same as everything else, never
  "cleaned" pre-embedding as if that were sufficient.
- Embedding model: reuse NIM (check for an embeddings endpoint) or
  flag as a real gap if NIM has none — don't silently pick a second
  provider.

## Files
migration, repository, DocumentService touch-point, aiToolRegistry
(+search_documents), docs/modules/Module-09-AI.md.

## Verification
Live: ingest a real doc, search returns real chunks, cross-tenant
isolation, classification filtering, hostile-content-in-doc proof
(mirror existing rule-9 tests). Full suite, no regressions.

## Output style
Token-efficient. Final report only: files changed (1 line each),
test/verification results, flags.
