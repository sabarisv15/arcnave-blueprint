# Module 6 — Documents & OCR

Status: Complete (migration → repository → service → API → UI). OCR
extraction itself is Module 9 (AI Tool Registry) territory — not
built here, not stubbed.

## Table
`documents` — student file metadata (certificates/photos/files).
`student_id` nullable (relaxed in Module 7 for non-student-owned files
like generated reports — every existing per-student caller unaffected).
`doc_type`/`status` free-text (`uploaded`/`verified`/`rejected`, no
`ai_extracted` — Module 9 territory). No `UNIQUE(student_id, doc_type)`
— re-uploads are new rows (versions), per Architecture.md 2.5's
"versioning" responsibility. `storage_path` (not a URL) — bytes owned
exclusively by DocumentService (CLAUDE.md rule 2). Soft-delete only,
no DELETE grant (retention).

## Service
`documentService.js` + `fileStorage.js` (ADR-017: local disk, single
instance per ADR-014, revisit when a second instance exists).
`sanitizeFileName` closes a directory-traversal door; storage paths
are collision-safe against the no-unique-constraint versioning scheme.
Upload never accepts a caller-supplied status; only `reviewDocument`
mutates a row (verified/rejected); soft-delete never touches disk.

## API
`backend/src/routes/documents.js` — `/api/v1/documents`
(upload/get/download/list/review/delete). Upload is base64-in-JSON
(no `multer` dependency for one endpoint, flagged, revisit when the UI
needs real `File` uploads). Download streams real bytes,
CRLF-injection-sanitized `Content-Disposition`. RBAC is the same
`requireRole('principal')`-for-writes placeholder every route uses —
not a real decision on who may verify documents.

## UI
`DocumentPanel.jsx` repointed off its dead prototype endpoints, wired
into `StudentEditorModal.jsx` as an edit-mode-only "Documents" step.
OCR button/panel stripped entirely (Module 9). Old fake-OCR "Upload
Documents" step deleted, not repointed (ran before a real `student.id`
existed).

## Known gaps / deferred
- OCR/AI extraction — Module 9.
- `docker-compose.yml` has no volume mounted for `DOCUMENT_STORAGE_ROOT`
  (ADR-017) — files live in the container's writable layer until fixed.
- No encryption-at-rest for stored files.
- RBAC placeholder, not a real role model for verify/review.

## Commits
`9b7d779` migration+repo · `ee46702` service (+ `fee_payments` FK
unblock) · `32ddf95` API · `7a7518d` UI
