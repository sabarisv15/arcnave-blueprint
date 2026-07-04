# RESULT

## Files changed
- `backend/migrations/1752500000000_module-6-documents-schema.js` (new)
- `backend/src/repositories/documentRepository.js` (new)

No service/API/UI files touched — matches this slice's own scope.

## What was built
A `documents` table (Module 6, Documents & OCR, first vertical slice)
scoped to student certificates/photos/files only, plus a matching
`documentRepository.js` offering pure query mechanics — same shape as
every prior module's first slice (`classes`, `attendance_sessions`,
`fee_structures`).

**Schema** (`documents`):
- `college_id` — tenant column, ENABLE + FORCE RLS + `tenant_isolation`
  policy, identical pattern to every other tenant table.
- `student_id` NOT NULL, `REFERENCES students(id)` — one student per
  row, no polymorphic owner. Staff documents / templates (also
  DocumentService-owned per Architecture.md 2.5) are out of scope this
  session.
- `doc_type` free TEXT, no CHECK — same "don't normalize what nothing
  queries that way yet" convention `fee_category`/`subject` already
  established. Known categories (documented, not enforced): `aadhaar`,
  `community_cert`, `bank_passbook`, `transfer_cert`, `birth_cert`,
  `income_cert`, `scholarship_cert`, `disability_cert`, `photo`.
- `file_name`, `storage_path`, `mime_type`, `file_size_bytes` — this
  table records file *metadata and location*, never bytes.
  `DocumentService` (a later slice) owns the actual storage write;
  this migration doesn't invent storage integration.
- `status` free TEXT, default `'uploaded'` (`uploaded` /
  `verified` / `rejected`) — enforced at the service layer once
  `DocumentService` exists, not the DB, matching `timetable_status`/
  `fee_structures.status`.
- `uploaded_by_user_id` NOT NULL, `verified_by_user_id` / `verified_at`
  nullable, `remarks` nullable — who/when/why shape mirroring
  `fee_structures.remarks`.
- `deleted_at` soft-delete, **resolved now** (unlike `students`' first
  slice, which left this an open question) — Architecture.md 2.5 names
  "retention" as a `DocumentService` responsibility, and certificates/
  ID scans are exactly the kind of artifact an accidental hard delete
  would irrecoverably destroy. GRANT omits DELETE entirely, same as
  `fee_structures`.
- No UNIQUE constraint on `(student_id, doc_type)` — re-uploading a
  type is a new row (a version), per Architecture.md 2.5's
  "versioning" responsibility, not an overwrite. A plain (non-unique)
  index on `(student_id, doc_type) WHERE deleted_at IS NULL` supports
  the "latest version of this type" lookup without blocking history.
- No Aadhaar *number* column anywhere (CLAUDE.md rule 8). Storing an
  `'aadhaar'` `doc_type` *label* on a scanned file is not "using
  Aadhaar for identity/dedup/search" — see the migration's file-level
  comment for the full reasoning, grounded in BusinessRules.md's own
  government-process carve-out.

**Repository** (`documentRepository.js`): `create`, `findById`,
`findByStudentId`, `findLatestByStudentAndType`, `update`,
`softDelete`, `list` — query mechanics only, no business logic, same
entries-filtering INSERT/UPDATE pattern as `financeRepository.js`. No
hard-delete function exists (matches the table's own GRANT).

## Which existing screen this was grounded against
`frontend/src/components/DocumentPanel.jsx` — a per-student document
grid whose upload/OCR/verify requests all target dead prototype
endpoints (none under `/api/v1/`, none matching a route this rebuild
has created). Not a backend to repoint — the same role the old
prototype played for every earlier module's first slice — but its
`DOC_TYPES` list and `uploaded → verified/rejected` states are exactly
what grounded `doc_type`'s known-category list and `status`'s
lifecycle. Its `not_uploaded`/`ai_extracted` states deliberately don't
appear in the schema: `not_uploaded` just means no row exists, and
`ai_extracted`/`ai_confidence` is Module 9 (AI Tool Registry) territory,
out of scope this session.
`frontend/src/components/ProfileCompletion.jsx` was also checked — it
only references document-type labels for a completion-percentage UI,
no upload/fetch logic of its own.

## Verification
1. **Migration applied** against the live `docker-compose` Postgres
   (`arcnave-blueprint-db-1`, already running) via
   `npm run migrate` — clean apply, confirmed via `\d documents`
   (all columns, FKs, the partial index, and the forced RLS policy
   present as designed).
2. **Repository exercised directly** (a throwaway script, same
   substitute technique used throughout this project's first slices
   where no HTTP layer exists yet — deleted after use, never
   committed): seeded a real tenant + 2 users + 1 student, then ran
   every repository function through its own transaction (mirroring
   one-transaction-per-request in the real app — reusing a single
   transaction for multiple inserts was tried first and produced a
   false failure, because Postgres's `now()` is frozen for an entire
   transaction, making all rows share one `created_at`; switching to
   per-call transactions fixed it and is the more realistic test
   anyway). All 15 functional checks passed: default `status`/
   `deleted_at`, versioning (two uploads of the same `doc_type` both
   persist), `findLatestByStudentAndType` resolves the newest version,
   `findByStudentId` orders newest-first and excludes soft-deleted
   rows, `findById` round-trips and excludes soft-deleted rows,
   `update` both verifies and rejects, `softDelete` is idempotent,
   `list` excludes soft-deleted rows.
3. **RLS proved through the real `arcnave_app` role**, not the
   migration/admin role — `MIGRATION_DATABASE_URL` (`arcnave_admin`) is
   a Postgres superuser and bypasses RLS unconditionally regardless of
   `FORCE ROW LEVEL SECURITY` (documented precedent:
   `rls-tenant-isolation.test.js`'s own negative-control test). Seeded
   a second tenant, connected as `arcnave_app` with
   `SET LOCAL app.current_tenant` set to that tenant, and confirmed its
   `list()` call returns none of the first tenant's documents — a real
   proof, not a vacuous one.
4. **Migration reversibility**: `npm run migrate:down` dropped the
   table cleanly (confirmed via `\dt documents` returning no relation),
   then `npm run migrate` re-applied it to leave the DB in the expected
   final state.
5. **Full existing suite regression check**: `npm test` — 351/351
   passing, 0 failures, after this slice's changes (up from 145 tests
   collected in an earlier partial env-var run; the full run needed
   `PLATFORM_DATABASE_URL` set alongside `DATABASE_URL`/
   `MIGRATION_DATABASE_URL`, all sourced from the local `.env`).
6. All seeded test data cleaned up afterward (real `DELETE`s via the
   admin connection, confirmed no leftover rows in
   `documents`/`students`/`users`/`colleges` for the test college IDs).

## Flags / open questions
- **No service/API/UI yet** — `documentService.js`, `/api/v1/documents`
  routes, and repointing `DocumentPanel.jsx` off its dead prototype
  endpoints are later slices, same vertical-build sequencing every
  prior module followed.
- **`fee_payments.receipt_document_id` is still a bare UUID with no FK**
  (restated, unchanged) — a later Finance-touching migration should now
  add `FOREIGN KEY (receipt_document_id) REFERENCES documents(id)`
  since `documents` exists as of this commit. Not done in this slice
  (out of this session's stated scope), but no longer blocked.
- **No actual file storage integration** — this table only records
  `storage_path`/`mime_type`/`file_size_bytes` metadata; the real
  upload-bytes-to-storage mechanism (local disk / S3-compatible /
  whatever gets chosen) is unbuilt, a later Module 6 slice's job.
- **No encryption-at-rest mechanism for stored files** — flagged in
  the migration comment specifically re: Aadhaar scans; a storage-layer
  concern for whichever slice adds real storage integration, not
  solved here.
- **`WorkflowService` (Module 8) still unbuilt** (restated, unchanged
  from every prior module) — a real document-verification approval
  flow, if one turns out to be needed beyond the simple
  `verified_by_user_id`/`verified_at` columns here, would route through
  it once it exists.
