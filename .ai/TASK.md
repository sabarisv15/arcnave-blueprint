# TASK

## Objective (Module 6 — Documents & OCR — second vertical slice)
`DocumentService` only — no API/UI this slice. Built on the
`documents` migration + `documentRepository.js` from the prior slice
(9b7d779).

## Storage backend: local disk (see ADR-017)
TechStack.md names no storage backend. Chosen: local disk under
`DOCUMENT_STORAGE_ROOT`, via a new `backend/src/storage/fileStorage.js`
(pure fs helpers, no DB, no business logic — used only by
`documentService.js`, per ADR-009's single-writer rule). Justification
in full: ADR-017. Short version: ADR-014 defers horizontal scaling (one
Express instance), and TechStack.md's deployment target is Docker/
Nginx/Postgres backups only — S3 buys nothing until a second instance
exists, and this project runs no object-storage infra today. Revisit
when ADR-014's own trigger (a second instance) fires.

## fee_payments.receipt_document_id FK: added this slice
The Module 5 migration's own comment named this exact follow-up ("once
Module 6 creates documents, must add ... FOREIGN KEY
(receipt_document_id) REFERENCES documents(id)"). `documents` now
exists (prior slice) — adding the FK is a small, contained, already-
planned unblock, not scope creep. Done as its own tiny migration, nothing
else touched in `fee_payments`.

## Key design decisions
- **doc_type gets no service-layer validation** — free TEXT, same
  "don't normalize" treatment `fee_category` gets in `financeService.js`
  (no validation there either). Unlike `status`, which DOES get
  validated (see next point) because it has real known-value semantics
  the service enforces, matching `fee_structures.status`'s precedent.
- **status validated at the service layer only on review** —
  `uploadDocument` never accepts a caller-supplied `status` at all (a
  freshly uploaded document is always `'uploaded'`, the DB default,
  full stop — no forged initial state, stricter than
  `fee_structures.status`, which does accept a caller value at create).
  A dedicated `reviewDocument` transitions to `'verified'`/`'rejected'`
  only — those are the only two states anything ever transitions a
  document *to* after upload.
- **Core file fields are immutable post-upload** — `doc_type`,
  `file_name`, `storage_path`, `mime_type`, `file_size_bytes`,
  `student_id` are never touched by any service function after
  `uploadDocument`. Re-uploading is a new row (versioning, per the
  migration's own reasoning), not an edit of the old one. Only
  `reviewDocument` (status/verifiedBy/verifiedAt/remarks) mutates an
  existing row — narrower than `financeService.updateFeeStructure`'s
  general-purpose whitelist, because nothing about an uploaded file's
  identity should change in place.
- **verifiedByUserId/verifiedAt are stamped by the service, never
  caller-supplied** — same "the actor is who did it right now, not
  caller-supplied free text" reasoning `financeService.markFeePayment`
  already applies to `markedByUserId`.
- **removeDocument (soft-delete) never touches storage** —
  `deleted_at` is set, the on-disk file is left alone. Consistent with
  the migration's own "retention" reasoning (Architecture.md 2.5):
  soft-deleting the DB row shouldn't destroy the recoverable evidence.
  A real hard-delete-with-file-removal path doesn't exist — the
  repository has no hard-delete function at all (same shape Finance's
  soft-delete-only tables already established).
- **downloadDocument reads bytes back from disk** — Architecture.md
  2.5 names "download" as one of DocumentService's owned
  responsibilities; not just a metadata read, an actual
  `fileStorage.readFile` round-trip.

## Files affected
- `docs/adr/ADR-017-Document-Storage-Backend.md` (new)
- `backend/src/storage/fileStorage.js` (new)
- `backend/src/config.js` (add `documentStorageRoot`)
- `backend/src/services/documentService.js` (new)
- `backend/tests/document-service.test.js` (new — mocked repository/
  storage, no live DB, same technique as `finance-service.test.js`)
- `backend/migrations/<ts>_fee-payments-receipt-document-fk.js` (new)

## Verification
- `documentService.js` unit tests (mocked `documentRepository`/
  `auditLogRepository`/`fileStorage`) — validation, immutability of
  post-upload fields, review-status enforcement, actor stamping.
- `fileStorage.js` exercised against the real local filesystem (not
  mocked in its own right) via a throwaway script: write, read back,
  confirm bytes match, confirm tenant-prefixed path shape; deleted
  after use.
- Live DB: apply the new FK migration against the running
  `docker-compose` Postgres, confirm `\d fee_payments` shows the new
  constraint, confirm `down` reverses cleanly, re-apply `up`.
- Full `npm test` regression run.
