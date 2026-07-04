# TASK

## Objective (Module 7 — Reports — third slice)
`pdfGenerator.js` (2.6) + wire it into `reportService.js` as a second
`format` option for `student_export`. No new report types, no API/UI.

## Library: pdfkit (ADR-019)
Resolves TechStack.md's named ReportLab-equivalent gap. Pure JS, no
native deps (same criterion ADR-017 used for storage), most widely
used Node PDF library for exactly this "build a document top-down"
job. pdf-lib/jsPDF/a headless-browser renderer considered and rejected
— see the ADR.

## Contract change: csvGenerator.generate is now async
pdfkit is stream-based — `pdfGenerator.generate` must return
`Promise<Buffer>`. Made `csvGenerator.generate` `async` too (trivially;
no real async work) so `reportService.js` awaits either generator
identically regardless of format.

## reportService.js: format is now a parameter
`generateStudentExportReport(client, { collegeId, format = 'csv' }, ...)`.
A `GENERATORS` map keys `csv`/`pdf` to `{generate, mimeType, extension}`.
Unknown format -> `ReportFormatError` (new, mirrors the "known-value,
service-enforced" shape `DocumentReviewStatusError` already uses) —
thrown before anything runs, same as the existing `collegeId`/
`actorUserId` guard.

## Files
- `docs/adr/ADR-019-PDF-Generator-Library.md` (new)
- `backend/package.json` (+pdfkit)
- `backend/src/generators/pdfGenerator.js` (new)
- `backend/src/generators/csvGenerator.js` (generate -> async)
- `backend/src/services/reportService.js` (format param + GENERATORS map)
- `backend/tests/report-service.test.js` (format cases)

## Verification
- Throwaway script: `generateStudentExportReport` with `format: 'pdf'`
  against live DB/filesystem — real PDF bytes (`%PDF` header) stored,
  correct `mime_type`, ledger row has `format: 'pdf'`.
- Existing csv path still green (contract change didn't break it).
- Full `npm test` regression.
