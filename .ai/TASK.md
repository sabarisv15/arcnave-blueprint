# TASK

## Objective (Module 6 — Documents & OCR — first vertical slice)
ERD + migration + repository only for a `documents` table — no
service/API/UI this slice, same discipline as every prior module's
first slice (`classes`, `attendance_sessions`, `fee_structures`).

Scope, explicitly bounded by this session's instructions: storage of
**student** certificates/photos/files only. OCR/AI extraction
(`ai_confidence`, an `ocr_results` table) is Module 9 (AI Tool
Registry) territory — not added here. Staff documents and college-wide
templates (also DocumentService-owned per Architecture.md 2.5) are
likewise out of scope for this slice.

## Grounding: which existing screen to check before guessing
Searched `frontend/src` for a real, wired document-upload screen
before drafting any column. Found two components that reference
documents, neither wired to a real backend:

- `frontend/src/components/DocumentPanel.jsx` — a per-student document
  grid. Every request it makes targets a **dead prototype endpoint**:
  `POST /api/students/:id/documents/upload`, `POST /api/ai/ocr`,
  `POST /api/students/:id/documents/:docType/verify` — none under
  `/api/v1/`, none matching any route this rebuild has created. Not a
  real backend to repoint, only a shape to ground the ERD against, the
  same role the old prototype played for every earlier module's first
  slice (per CLAUDE.md: "prototype validated scope only, not the
  foundation").
- `frontend/src/components/ProfileCompletion.jsx` — lists document
  keys (`aadhaar`, `community_cert`, `bank_passbook`, `income_cert`)
  as items counted toward profile completion; no upload/fetch logic of
  its own, just labels.

`DocumentPanel.jsx`'s `DOC_TYPES` gives the real, concrete category
list a `doc_type` column needs to support:
`aadhaar`, `community_cert`, `bank_passbook`, `transfer_cert`,
`birth_cert`, `income_cert`, `scholarship_cert`, `disability_cert` —
plus a plain student **photo**, named explicitly in this session's own
scope ("certificates/photos/files") but absent from that list.
Its status lifecycle (`not_uploaded → uploaded → ai_extracted →
verified/rejected`) is a *client-side* display state, not a schema to
port verbatim: `not_uploaded` is simply "no row exists yet", and
`ai_extracted` is Module 9 territory, excluded this slice per the
session's own scope. What survives into this table's `status` column
is `uploaded → verified/rejected` only.

## Key design decisions
- **`doc_type` stays free TEXT, no CHECK** — same "don't normalize what
  nothing queries that way yet" reasoning `fee_structures.fee_category`
  and `faculty_allocation.subject` already established. The 9 categories
  above (8 certs + photo) are documented in the migration comment as
  the known set, not enforced by a constraint.
- **`student_id` NOT NULL, scoped to one student** — no polymorphic
  owner column. Staff documents / templates are a different
  DocumentService responsibility, explicitly out of scope this
  session, not modeled with a nullable/polymorphic column "just in
  case."
- **No unique constraint on `(student_id, doc_type)`** — Architecture.md
  2.5 names "versioning" as one of DocumentService's owned
  responsibilities; re-uploading a document type is a new row (a new
  version), not an overwrite of the old one. `DocumentPanel.jsx`'s
  single-record-per-type grid is a *display* convention (show the
  latest), not a schema constraint — a repository helper
  (`findLatestByStudentAndType`) resolves "latest" without a table
  constraint blocking history.
- **`status` free TEXT, no CHECK, default `'uploaded'`** — same house
  convention as `timetable_status`/`fee_structures.status`: known
  values (`uploaded`/`verified`/`rejected`) enforced at the service
  layer once `DocumentService` exists (not built this slice), not the
  DB.
- **`deleted_at` soft-delete, resolved now, not deferred** — unlike
  `students`' first slice (which left this an open question),
  Architecture.md 2.5 explicitly names "retention" as one of
  DocumentService's owned responsibilities, and these rows represent
  hard-to-replace artifacts (certificates, ID scans) where an
  accidental hard delete is exactly the kind of loss "retention"
  exists to prevent. Not a rule named as explicitly as fees/attendance/
  marks in BusinessRules.md's AI section, but the same risk-averse
  default, flagged as a deliberate choice, not a guess. GRANT omits
  DELETE, same as `fee_structures`.
- **`storage_path` (not file bytes) is what this table stores** —
  Architecture.md 2.9 / CLAUDE.md rule 2: `DocumentService` is the sole
  owner of file storage; this table only records *where* a file lives
  (a tenant-prefixed path DocumentService will assign), not the bytes
  themselves. No actual storage integration exists yet — a later
  slice's problem, not silently solved here.
- **Storing an `'aadhaar'` `doc_type` value does not violate CLAUDE.md
  rule 8** — rule 8 restricts *using* Aadhaar numbers "for identity,
  dedup, import, search, AI reasoning, or reporting." This table never
  reads or reasons over the Aadhaar *number* at all — it records the
  existence and storage location of a scanned card image, labeled like
  any other document category, exactly the carve-out BusinessRules.md
  itself describes ("If a college requires it for a government
  process, it is stored as an optional, encrypted, access-restricted
  field only"). Encryption-at-rest for the actual file bytes is a
  storage-layer concern for a later Module 6 slice once real storage
  integration exists — flagged as an open gap, not solved here.
- **`uploaded_by_user_id` NOT NULL, `verified_by_user_id`/`verified_at`
  nullable** — mirrors the "who/when" shape BusinessRules.md's
  Staff/Finance approval chains already use elsewhere, without
  inventing new bookkeeping columns approval doesn't need yet
  (`remarks` covers a rejection/verification note, same role
  `fee_structures.remarks` plays).
- **No Aadhaar *number* column anywhere** (CLAUDE.md rule 8) — only a
  free-text `doc_type` label, per the point above.

## Files affected
- `backend/migrations/1752500000000_module-6-documents-schema.js` (new)
- `backend/src/repositories/documentRepository.js` (new)

## Verification
- Run `npm run migrate` against the live `docker-compose` Postgres
  (already running, `arcnave-blueprint-db-1`); confirm the migration
  applies cleanly.
- Exercise the repository directly (a small throwaway script, same
  substitute technique used for API-shape proof in prior slices where
  no HTTP layer exists yet): seed a tenant + student + user, then
  `create`, `findById`, `findLatestByStudentAndType`,
  `findByStudentId`, `update` (verify/reject), `softDelete` — confirm
  each round-trips correctly and `deleted_at` rows drop out of reads.
- Run `npm run migrate:down` to confirm the migration reverses cleanly,
  then re-run `up` to leave the DB in the expected final state.
- Clean up all seeded data afterward.
