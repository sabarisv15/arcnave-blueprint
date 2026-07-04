# RESULT

## Files changed
- `backend/package.json`, `backend/package-lock.json` (+`docxtemplater`, `pizzip`)
- `backend/src/generators/templateMerger.js` (new — pure `mergeTemplate`)
- `backend/src/services/documentService.js` (+`uploadTemplate`, +re-exported `mergeTemplate`/`TemplateMergeError`/`TEMPLATE_DOC_TYPE`)
- `docs/architecture/TechStack.md`, `docs/modules/Module-06-Documents.md` (docs)

No migration — `documents.student_id` (nullable since 1752800000000)
and `doc_type` (free TEXT) already support this shape.

## What was built
**Storage**: `documentService.uploadTemplate(client, {collegeId,
fileName, mimeType, fileBuffer}, {actorUserId})` — a thin wrapper over
the existing `uploadDocument`, fixing `doc_type = 'template'`,
`student_id = null` (neither caller-suppliable through this path).
Same table, same `storage_path`, same validation/audit-logging
`uploadDocument` already has — no parallel implementation.

**Merge**: `generators/templateMerger.js`'s `mergeTemplate(templateBuffer,
fields) -> Buffer` — a pure function (no DB, no storage), `docxtemplater`
+ `pizzip`. No fixed field list: an unmatched `{{tag}}` renders blank
(`nullGetter`) rather than throwing.

## Real bug found and fixed during live verification
docxtemplater's own default delimiter is single-brace `{tag}` (it
reuses that character for its loop/condition syntax), not `{{tag}}`.
This project's templates are specified as `{{field}}`, so the first
version (relying on the library default) failed every real template
with a confusing "duplicate open tag"/"duplicate close tag" error —
`{{studentName}}` was being lexed as two nested single-brace tags.
Fixed by setting `delimiters: { start: '{{', end: '}}' }` explicitly in
the `Docxtemplater` constructor options. Caught empirically (a real
generated `.docx` template failed to merge), not by reading the
library's docs in advance.

## CLAUDE.md rule 9 (merge field VALUES are untrusted, never instructions)
docxtemplater parses a template's own `{{tags}}` once, at load time,
from the template's XML; a field VALUE is substituted afterward as a
literal XML text node, never re-scanned for further tags. Verified
live, not just asserted: a field value containing literal `{{rollNo}}`
text and a fragment resembling a closing XML tag rendered as that exact
string in the merged output, never re-substituted or interpreted as a
second tag. The one thing that would break this guarantee — attaching
docxtemplater's optional angular-expressions/eval parser module — is
never done here.

## Verification
Live against the real docker-compose Postgres + a real generated
`.docx` template (one-off script, deleted after use): uploaded via
`uploadTemplate` (`doc_type='template'`, `student_id=NULL` confirmed on
the row); a second tenant's `getDocument` on the same id returned
`null` (RLS holds for template rows, same as student-document rows);
downloaded bytes byte-identical to the upload; `mergeTemplate`
correctly substituted every `{{field}}`; a missing field rendered
blank rather than throwing; the rule-9 hostile-value proof above; a
non-`.docx` buffer raised a clean `TemplateMergeError`. Full backend
suite: 430/430 (no regressions; no new automated tests added — this
slice is storage + a generator, same "one-off verification script,
deleted after use" pattern this project's other first-slice
migration/repository/generator commits already use, not a service
layer with its own permanent unit-test file yet).

## Flags
- No API/UI: nothing yet accepts a template upload or a merge request
  from outside; a future slice wires a route (or NotificationService,
  which Architecture.md 2.5 already names as composing DocumentService's
  templates) into these two functions.
- No orchestration combining upload -> merge -> store-the-filled-result
  into one flow — this slice built storage and merge as two separate
  pieces, per its own scope.
- No mime-type/content check that an upload tagged `doc_type =
  'template'` is actually a `.docx` at upload time; `mergeTemplate` is
  what needs a valid `.docx`, and validates that at merge time instead.
