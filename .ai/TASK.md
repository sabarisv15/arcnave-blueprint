# TASK

## Objective (Module 7 — Reports — second slice)
`csvGenerator.js` (Generator Module, 2.6) + `reportService.js`. No
API/UI.

## Real gap found and fixed: documents.student_id was NOT NULL
A generated report (e.g. "export every student") isn't owned by one
student the way a certificate is, but 2.6's flow requires
DocumentService to store the bytes (CLAUDE.md rule 2 — no bypassing
it). Module 6 scoped `documents.student_id NOT NULL` because that
slice's own stated scope was student files only, not because every row
must belong to a student (2.5 already frames DocumentService as owning
"all files"). Fixed via a small migration
(`1752800000000_documents-student-id-nullable.js`) dropping the
constraint, `documentService.uploadDocument`'s `studentId` requirement
relaxed to optional, and `fileStorage.buildStoragePath` using a
`'shared'` path segment when absent. Every existing per-student caller
is unaffected — this only widens what's allowed.

## Report type: student_export (CSV only)
Checked `CsvExportModal.jsx` again — real column set, but using actual
`students` table column names, not that modal's stale MongoDB-era
aliases. Its "Attendance" section (attendance %, blood_group, dob)
dropped: none of those three are real columns anywhere in this schema.
No class-scoped export — `students` has no `class_id` column anywhere
(checked before assuming otherwise); a flat, tenant-wide, hardcoded-
limit (5000) export instead, same pragmatic cap
`?limit=200` fetches already use elsewhere.

No separate `audit_log` entry from `reportService.js` — `generated_reports`
already is this action's audit record (ADR-018).

## Files
- `backend/migrations/1752800000000_documents-student-id-nullable.js` (new)
- `backend/src/storage/fileStorage.js` (studentId optional)
- `backend/src/services/documentService.js` (studentId optional)
- `backend/src/generators/csvGenerator.js` (new)
- `backend/src/services/reportService.js` (new)

## Verification
- Migration up/down/up live.
- Existing `document-service.test.js`/`documents.test.js` still green
  (studentId-optional change shouldn't break per-student behavior).
- Throwaway script: `generateStudentExportReport` end to end against
  live DB — real CSV bytes round-trip through DocumentService, ledger
  row `completed` + `document_id` set; a forced-failure path writes
  `failed` + `error_message`, `document_id` null.
- Full `npm test` regression.
