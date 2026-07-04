# RESULT

## Files changed
- `docs/adr/ADR-017-Document-Storage-Backend.md` (new)
- `backend/src/storage/fileStorage.js` (new)
- `backend/src/config.js` (`documentStorageRoot`)
- `backend/src/services/documentService.js` (new)
- `backend/tests/document-service.test.js` (new)
- `backend/migrations/1752600000000_fee-payments-receipt-document-fk.js` (new)
- `backend/tests/finance.test.js` (fixed — see below)
- `.gitignore` (`backend/storage/`)

No API/UI touched — matches this slice's scope.

## Storage backend: local disk (ADR-017)
TechStack.md named none. Chosen over S3 because ADR-014 defers
horizontal scaling to a single Express instance (S3's shared-blob-store
advantage buys nothing until a second instance exists) and the
deployment target is Docker/Nginx/Postgres-backups only, with no
object-storage credential/bucket provisioned anywhere. Local disk under
a tenant-prefixed tree, same persistence pattern already proven for
Postgres's own `pgdata` volume. Revisit trigger: ADR-014's own trigger
(a second app instance).

## What was built
`documentService.js` — validation, actor stamping, audit logging, and
storage read/write, on top of `documentRepository.js`/`fileStorage.js`:
`uploadDocument`, `getDocument`, `downloadDocument`,
`listDocumentsForStudent`, `getLatestDocumentForStudentAndType`,
`reviewDocument`, `removeDocument`, `listDocuments`.

Key decisions (full reasoning in each file's own comments):
- `uploadDocument` never accepts a caller-supplied `status` — always
  the DB default `'uploaded'`. `doc_type` gets no service-layer
  validation (free text, same as `fee_category`); `status` DOES, but
  only inside `reviewDocument`, to `'verified'`/`'rejected'` only.
- Core file identity (`doc_type`/`file_name`/`storage_path`/
  `mime_type`/`file_size_bytes`/`student_id`) is immutable after
  upload — only `reviewDocument` mutates a row (status/verifiedBy/
  verifiedAt/remarks), narrower than `financeService.updateFeeStructure`'s
  general whitelist by design.
- `verifiedByUserId`/`verifiedAt` are always stamped by the service
  from the actor/clock, never caller-supplied.
- `removeDocument` (soft-delete) never touches `fileStorage` — the
  file stays on disk even after `deleted_at` is set, per Architecture.md
  2.5's "retention" responsibility.
- `downloadDocument` does a real bytes-from-disk round-trip
  (Architecture.md 2.5 names "download" explicitly), not just a
  metadata read.
- `fileStorage.js` sanitizes `fileName` (strips anything but
  alnum/dot/dash/underscore) before building a path — closes a
  directory-traversal door at the one place paths get built.

## fee_payments.receipt_document_id: FK added this slice
The Module 5 migration's own comment pre-planned this exact follow-up.
`documents` exists as of the prior slice, so
`1752600000000_fee-payments-receipt-document-fk.js` adds
`FOREIGN KEY (receipt_document_id) REFERENCES documents(id)` — nothing
else touched in `fee_payments`. No `NOT VALID`/`VALIDATE` split: dev-only
schema, no production rows to violate the new constraint.

This broke one existing test:
`finance.test.js`'s "re-marking updates the existing payment" test
inserted a bare `crypto.randomUUID()` for `receipt_document_id` with no
matching row — a 23503 under the new FK instead of the 200 it expected.
Fixed by seeding a real `documents` row via `adminPool` first and using
its real id; also added `documents` to that test file's tenant cleanup
(deleted before `fee_structures`, since `fee_payments` — deleted first
— is what references `documents`, not the other way around).

## Verification
1. **`documentService.js` unit tests** (`document-service.test.js`,
   mocked repository/storage, no live DB/filesystem) — 13 cases:
   missing-field/missing-actor rejection, status-forging rejection,
   write-before-create ordering, FK-violation mapping, review-status
   whitelist enforcement, actor/timestamp stamping (never caller-
   supplied), no-op-on-missing-id (no audit entry), soft-delete never
   touching storage, download's found/not-found paths. All pass.
2. **`fileStorage.js` against the real filesystem** (throwaway script,
   deleted after use): confirmed `buildStoragePath` strips a
   `../../etc/passwd`-style traversal attempt down to a safe
   tenant-prefixed path, a real `writeFile`/`readFile` round-trip
   matches bytes exactly, and two uploads of the identical `fileName`
   get distinct paths (no silent overwrite).
3. **FK migration** applied against the live `docker-compose`
   Postgres: `\d fee_payments` shows
   `fee_payments_receipt_document_id_fkey` referencing `documents(id)`;
   `down` drops it cleanly, re-applied `up` after.
4. **Full suite regression**: `npm test` — 364/364 passing (up from
   351: +13 new `document-service.test.js` cases, plus the
   `finance.test.js` fix holding).

## Flags / open questions
- **No API/UI yet** — `/api/v1/documents` routes and repointing
  `DocumentPanel.jsx` off its dead prototype endpoints are the next
  slice(s), same vertical sequencing every prior module followed.
- **`docker-compose.yml` doesn't mount a persistent volume for
  `DOCUMENT_STORAGE_ROOT`** yet (ADR-017's own flagged consequence) —
  uploaded files currently live inside the app container's writable
  layer, gone on container recreation. Needs a named volume (mirroring
  `pgdata`) before this is deploy-safe; not this slice's job.
- **No backup story for on-disk files** (ADR-017) — Postgres has
  `pg_dump`; uploaded bytes do not have an equivalent yet.
- **No encryption-at-rest** — flagged in the Module 6 migration's own
  comment (re: Aadhaar scans specifically), still unsolved; a
  storage-layer concern for whenever it's prioritized.
- **`WorkflowService` (Module 8) still unbuilt** (restated) —
  `reviewDocument`'s verify/reject is a direct, ungated action for now,
  same "no real approval gate exists yet" caveat every other module's
  status-transition logic already carries.
