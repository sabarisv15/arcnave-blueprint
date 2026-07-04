# TASK

## Objective (Module 7 — Reports — fifth slice)
`wordGenerator.js` (2.6, `Promise<Buffer>` contract) + fourth
`GENERATORS` entry (`docx`) in `reportService.js`. No new report
types, no API/UI. Completes the tabular Generator lineup
(csv/pdf/xlsx/docx) — PPT stays parked.

## Library: docx, no ADR
Matches TechStack.md's named gap ("Node equivalent of python-docx") by
the same pure-JS/no-native-deps criteria ADR-017/019/excelGenerator.js
already used — expected default, no alternatives weighed, no ADR (same
treatment exceljs got). `npm audit` unchanged after install (4
vulnerabilities, all pre-existing — `docx` added nothing new).

Unlike `pdfGenerator.js`, no manual column-width/pagination math
needed: a docx `Table` wraps/paginates on its own in Word, so
`student_export`'s 22 columns don't need PDF's landscape/small-font
workaround.

## Files
- `backend/package.json` (+docx)
- `backend/src/generators/wordGenerator.js` (new)
- `backend/src/services/reportService.js` (`GENERATORS.docx`)
- `backend/tests/report-service.test.js` (docx cases)

## Verification
- Throwaway script: live DB/filesystem round-trip, `format: 'docx'` —
  real bytes stored, correct mime type, `student_id IS NULL`.
- Committed tests: `wordGenerator` output structurally verified (real
  docx/zip archive, contains the expected text), `reportService`
  `docx`-format wiring through the real generator.
- Full `npm test` regression.
