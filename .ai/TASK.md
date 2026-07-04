# TASK

## Objective (Template-fill, first slice)
DocumentService gains template storage + merge. Templates are `.docx`
with `{{field}}` placeholders, uploaded via College Admin
(BusinessRules.md's already-resolved item 2), stored like any other
document (`documents` table, `storage_path`, DocumentService-owned per
CLAUDE.md rule 2) but tagged distinguishably from student files
(`doc_type = 'template'`, `student_id` NULL — already nullable per
Module 6).

## Scope
Storage + a pure `mergeTemplate(templateBuffer, fields) -> Buffer`
function only. No API/UI, no fixed field list (generic, any uploaded
template) — field names come from whatever the template itself
defines. No schema change: `documents.student_id`/`doc_type` already
support this shape.

## Library
`docxtemplater` + `pizzip` — the common pure-JS choice, no native deps,
same criteria ADR-017/019 used. Expected default, not a deviation, so
no new ADR.

## Constraints
- CLAUDE.md rule 2: DocumentService is the sole owner of file storage.
- CLAUDE.md rule 9: merge field VALUES are untrusted data, never
  interpreted as instructions.
- Architecture.md 2.5: DocumentService owns "templates" by name.

## Verification
Live against the real docker-compose Postgres, deleted one-off script:
upload/download roundtrip, cross-tenant isolation on template rows,
real field substitution, a hostile-looking field value proven to
render literally (rule 9), missing-field tolerance, and a clean error
on a non-`.docx` buffer.
