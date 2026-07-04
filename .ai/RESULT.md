# RESULT

## Files changed
- `backend/src/repositories/documentRepository.js` (+`findByDocType`)
- `backend/src/services/documentService.js` (+`listTemplates`,
  +`mergeDocumentTemplate`, +`DocumentNotATemplateError`)
- `backend/src/routes/documents.js` (+`POST`/`GET /documents/templates`,
  +`POST /documents/:id/merge`)
- `frontend/src/pages/CollegeAdminDashboard.jsx` (+Document Templates card)
- `frontend/src/components/StudentEditorModal.jsx` (+Generate from Template)
- `frontend/src/components/Header.jsx` (incidental fix, see below)

No migration change — built entirely on the already-committed
`documents` schema.

## What was built
**Service**: `mergeDocumentTemplate(client, templateId, fields)` —
looks up the document by id first (`findById`, no disk read), throws
`DocumentNotATemplateError` if `doc_type !== 'template'`, only then
reads the file and calls `mergeTemplate`. `listTemplates` backs the
picker UI (`findByDocType('template')`).

**Routes**: `POST /documents/templates` (`requireRole('college_admin')`,
calls `uploadTemplate`) · `GET /documents/templates` (`requireAuth`) ·
`POST /documents/:id/merge` (`requireAuth`, streams merged bytes back
with the same `Content-Type`/`Content-Disposition` shape
`GET /documents/:id/download` already uses — nothing is stored).

**UI**: College Admin dashboard gained a "Document Templates" card
(file input → base64 upload). `StudentEditorModal.jsx`'s Documents step
gained "Generate from Template" — a picker + button, fields built from
this student's own already-loaded real form state (no fixed tag list),
downloaded via the same Blob/object-URL pattern `DocumentPanel.jsx`
already uses.

## A real bug found live (fixed one narrow symptom, flagged the rest)
`StudentEditorModal.jsx`'s only real edit-mode caller is
`TutorClass.jsx`. Browser-testing "Generate from Template" there
surfaced a pre-existing, unrelated crash: `Header.jsx` called
`user.username.charAt(0)` unconditionally, but `GET /api/v1/auth/me`
has never returned `username` (only `user_id`/`college_id`/`role`,
Module 0's own design). Fixed that one line (falls back to
`user.role`). Digging further: `TutorClass.jsx` itself hangs forever
for any real backend user regardless — `fetchData` returns early
whenever `selectedTutorId` is unset, and `selectedTutorId` is seeded
from the same nonexistent `user.username`. That deeper gap (no
`username` in the JWT/`auth-me` contract, or `TutorClass.jsx`'s
tutor-identity model itself) is flagged in
`Module-06-Documents.md`'s Known Gaps, not fixed — real, separate work
well outside this slice's scope.

## Verification
Full backend suite: 430/430, no regressions. An HTTP round-trip script
(one-off, deleted after use) proved: RBAC (403 for non-college_admin
template upload), a real `.docx` template uploaded and listed, merge
correctly substituting real fields, the rule-9 hostile-value proof (a
field value containing literal `{{rollNo}}` text rendered as that
exact string, never re-substituted), merging a non-template document
400s cleanly, merging a missing id 404s. Then a real browser (headless
Chrome via `playwright-core`, scratch-installed, not added to this
repo's dependencies): College Admin's template upload confirmed end to
end (toast, list updates, real `.docx` accepted, no console errors).
The student-profile "Generate from Template" UI could not be exercised
live — blocked by the pre-existing bug above, not anything in this
slice; its correctness rests on the already-proven backend route plus
a direct match against the same download pattern already proven live
elsewhere in this codebase. Frontend production build clean, before
and after the `Header.jsx` fix.

## Flags
- The `TutorClass.jsx` / `auth-me` `username` gap above — real,
  reproducible, blocks live UI verification of this slice's own
  student-facing feature. Not fixed here.
- No orchestration linking upload → merge → store-the-result; merge
  only ever streams bytes back.
- No mime-type/content check that an upload tagged `doc_type =
  'template'` is really a `.docx` at upload time (unchanged from the
  prior slice — `mergeTemplate` still validates at merge time).
