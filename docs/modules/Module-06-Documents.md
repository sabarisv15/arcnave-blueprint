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

## Template storage + merge (first slice, post-Module-6)
Closes this module's own migration comment: "college-wide templates —
also DocumentService-owned per Architecture.md 2.5 — are ... out of
scope this slice." No schema change needed — `documents.student_id`
was already nullable, `doc_type` already free TEXT: a template is
stored through `documentService.uploadTemplate` (a thin wrapper over
`uploadDocument` fixing `doc_type = 'template'`, `student_id = null`,
not caller-suppliable), same table, same `storage_path`, same
tenant-scoped path every other document uses.

`generators/templateMerger.js` — a pure function (Architecture.md 2.6
/ ADR-008 restraint: no DB, no storage, no permissions),
`mergeTemplate(templateBuffer, fields) -> Buffer`. Library:
`docxtemplater` + `pizzip`, same pure-JS/no-native-deps criteria
ADR-017/019 used — the expected default, not a deviation, so no new
ADR (same treatment `wordGenerator.js`'s `docx` choice got). No fixed
field list: whatever `{{tags}}` the uploaded template itself defines
are whatever gets filled; a tag with no matching field renders blank
(`nullGetter`) rather than throwing, since a generic caller-defined
template not using every field it *could* is normal, not an error.

**CLAUDE.md rule 9 (merge field VALUES are untrusted data, never
instructions)**: docxtemplater's default mode does literal tag-for-
value substitution only — a value is inserted as an XML text node once
the template's own `{{tags}}` have already been parsed, never
re-scanned for further tags, so a value that itself contains `{{...}}`
renders as that literal string, not a nested substitution. Verified
live, not just asserted (see below). The one thing that would break
this guarantee — attaching docxtemplater's optional angular-
expressions/eval parser module — is deliberately never done here.

One real bug caught during live verification, not by inspection:
docxtemplater's own default delimiter is single-brace `{tag}` (it
reuses the same brace character for its loop/condition syntax), not
`{{tag}}` — this project's templates are specified as `{{field}}`
(this slice's own build brief), so `delimiters: { start: '{{', end:
'}}' }` must be set explicitly in the `Docxtemplater` constructor
options; relying on the library default silently parsed
`{{studentName}}` as two nested single-brace tags and failed with a
confusing "duplicate open tag" error instead of matching what a
template author actually wrote.

No API/UI yet — no route accepts a template upload or a merge request
from the outside; a future NotificationService/College-Admin-facing
slice wires this in (Architecture.md 2.5 already names NotificationService
as composing DocumentService's templates).

Verified live against the real docker-compose Postgres + a real
generated `.docx` (one-off script, deleted after use): uploaded a
template through `uploadTemplate` (`doc_type='template'`,
`student_id=NULL` confirmed on the row); a second tenant's `getDocument`
on the same id returned `null` (RLS holds for template rows exactly
like student-document rows); downloaded bytes were byte-identical to
the upload; `mergeTemplate` correctly substituted every `{{field}}`,
left an unmatched tag blank rather than throwing, and — the rule-9
proof — a field value containing literal `{{rollNo}}` text and a
fragment resembling a closing XML tag rendered as that exact literal
string in the output, never re-substituted or interpreted; a
non-`.docx` buffer raised a clean `TemplateMergeError` instead of an
opaque library exception. Full backend suite: 430/430 (no regressions;
no new automated tests added this slice, consistent with this
project's other first-slice migration+repository/generator commits).

## Template-fill: service + API + UI + one real caller
Closes the "has no API/UI yet" gap the prior slice flagged.

**Service** (`documentService.js`): `listTemplates` (thin wrapper,
`documentRepository.findByDocType('template')`) and
`mergeDocumentTemplate(client, templateId, fields)` — composes
`downloadDocument` + `mergeTemplate` into the one real caller this
slice names. Checks `doc_type === 'template'` via a plain `findById`
**before** touching disk (`DocumentNotATemplateError` otherwise) —
found live during verification that checking AFTER
`downloadDocument`'s own disk read let a wrong-doc-type id surface a
raw `ENOENT` instead of a clean domain error; reordered so identity is
confirmed before the fallible read ever runs.

**API** (`routes/documents.js`): `POST /documents/templates`
(`requireRole('college_admin')`, calls `uploadTemplate` — BusinessRules.md
item 2) · `GET /documents/templates` (`requireAuth` — any authenticated
user needs to see what's available to generate from) ·
`POST /documents/:id/merge` (`requireAuth`) — streams the merged bytes
back with the exact same `Content-Type`/`Content-Disposition`/`res.send`
shape `GET /documents/:id/download` already uses; nothing is stored,
the merged bytes exist only in that one response.

**UI**: `CollegeAdminDashboard.jsx` gained a "Document Templates" card
(file input → base64 → `POST /documents/templates`, same convention
every other upload in this codebase already uses). `StudentEditorModal.jsx`'s
Documents step gained "Generate from Template": a template picker +
Generate button, `fields` built from this student's own real, already-
loaded form state (no fixed tag list — whatever `{{tags}}` a template
defines are whatever get filled, matching `mergeTemplate`'s own
`nullGetter` behavior for anything a given template doesn't use),
downloaded via the same Blob/object-URL pattern `DocumentPanel.jsx`'s
`handleDownload` already uses.

**CLAUDE.md rule 9** still holds exactly as `templateMerger.js`
documents: `fields` in the merge request body is untrusted (real
student data, human-entered) and is only ever inserted as literal
text — verified live again through the actual API (a hostile field
value containing `{{rollNo}}` and a fake closing-XML-tag fragment
rendered literally, never re-substituted).

**A real, unrelated bug found live, not fixed here beyond one narrow
symptom**: `StudentEditorModal.jsx`'s only real caller with edit-mode
access to a real student is `TutorClass.jsx`. `GET /api/v1/auth/me`
returns only `user_id`/`college_id`/`role` (Module 0's own design,
`routes/auth.js`) — it has never returned `username`. Large parts of
`TutorClass.jsx` (`selectedTutorId`, the tutor-identity comparisons
gating the Edit button, `Header.jsx`'s avatar initial) assume
`user.username` exists. This means `TutorClass.jsx` hangs indefinitely
("Loading class dashboard...", `fetchData` returns early whenever
`selectedTutorId` is unset) for **any** real backend-authenticated
user today, regardless of role — a pre-existing gap between the old
prototype's user shape and the real JWT claims, unrelated to this
slice's own scope. One narrow symptom of the same root cause was fixed
in passing (`Header.jsx` crashed outright — `user.username.charAt(0)`
on `undefined` — rather than degrading; now falls back to `user.role`).
The underlying gap (no `username` in the JWT/`/auth/me` contract, or
`TutorClass.jsx`'s tutor-identity model itself) is flagged here, not
fixed — extending the JWT contract or rewriting that page's identity
model is real, separate work.

**Verified live**: full HTTP round-trip script (one-off, deleted after
use) — RBAC (403 for a non-college_admin template upload), a real
`.docx` template uploaded and listed, `POST /documents/:id/merge`
correctly substituting real fields, the rule-9 hostile-value proof,
merging a non-template document 400s cleanly (post-reorder), merging a
missing id 404s. Then a real browser (headless Chrome via
`playwright-core`, scratch-installed, not added to this repo's
dependencies): College Admin's template upload UI confirmed end to end
(toast, list updates, real `.docx` accepted). The
`StudentEditorModal.jsx` "Generate from Template" UI itself could
**not** be exercised in a live browser session — blocked by the
pre-existing `TutorClass.jsx`/`auth-me` gap above, not by anything in
this slice. Its correctness rests on: the already-proven backend route
it calls, a direct code-level match against the exact same
Blob-download pattern already proven live elsewhere in this codebase
(`DocumentPanel.jsx`, `PrincipalDashboard.jsx`'s student export), and a
clean production build. Full backend suite: 430/430. Frontend
production build clean, both before and after the `Header.jsx` fix.

## Known gaps / deferred
- OCR/AI extraction — Module 9.
- ~~`docker-compose.yml` has no volume mounted for `DOCUMENT_STORAGE_ROOT`~~
  — fixed: a named `document_storage` volume is now mounted at
  `DOCUMENT_STORAGE_ROOT` (ADR-017's Consequences section). Backup and
  encryption-at-rest are still not implemented, only planned — see
  ADR-017's new "Backup & Encryption plan" section.
- No encryption-at-rest for stored files (planned, not built — see
  ADR-017).
- RBAC placeholder, not a real role model for verify/review.
- No mime-type/content validation that an upload tagged `doc_type =
  'template'` is actually a `.docx` at upload time — `mergeTemplate`
  is what needs a valid `.docx`, and it validates that at merge time,
  raising `TemplateMergeError` rather than silently failing.
- No orchestration linking upload → merge → re-upload-as-a-stored-
  document into one flow — merge only ever streams bytes back, it
  never calls `uploadDocument`.
- The `TutorClass.jsx` / `GET /api/v1/auth/me` `username` gap
  described above — real, reproducible, blocks the one live browser
  path this slice's own UI needed to prove itself through end to end.

## Commits
`9b7d779` migration+repo · `ee46702` service (+ `fee_payments` FK
unblock) · `32ddf95` API · `7a7518d` UI · template storage + merge ·
template-fill service + API + UI + one real caller (this slice)
