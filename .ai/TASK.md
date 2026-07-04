# TASK

## Objective (Template-fill: service + API + UI + one real caller)
`POST /api/v1/documents/:id/merge` (template id + fields -> merged
`.docx` via the existing download response shape), calling
`uploadTemplate`/`mergeTemplate`. UI: template upload under College
Admin; "Generate from template" on student profile, fields from real
student data, no fixed tag list.

## Scope
`documentService.mergeDocumentTemplate` composes `downloadDocument` +
`mergeTemplate` (with a `doc_type === 'template'` identity check
before any disk read). New `documentRepository.findByDocType` +
`documentService.listTemplates` back the picker UI. Three routes:
`POST`/`GET /documents/templates`, `POST /documents/:id/merge`. No
schema change.

## Constraints
- Module-06-Documents.md, CLAUDE.md rules 2/9, `templateMerger.js`
  (`0cf46e3`) — merge field values stay untrusted, literal text only.
- Template upload is `college_admin`-only
  (`BusinessRules.md`'s College Admin resolution, item 2); the merge
  read is `requireAuth` (whoever's viewing a student profile).

## Verification
Live: full backend suite + an HTTP round-trip script (RBAC, real
`.docx` upload/list, merge substitution, rule-9 hostile-value proof,
non-template 400, missing-id 404) — then a real browser (headless
Chrome via `playwright-core`) for the College Admin upload UI. The
student-profile "Generate from template" UI could not be exercised
live: found a pre-existing, unrelated bug (`TutorClass.jsx`'s only
real edit-mode caller of `StudentEditorModal.jsx` hangs forever for
any real backend user, because `GET /api/v1/auth/me` never returns
`username`, which that page's tutor-identity logic assumes exists).
Fixed one narrow symptom (`Header.jsx`'s crash on it) in passing;
flagged the deeper gap, did not fix it (real, separate work, out of
this slice's scope).
