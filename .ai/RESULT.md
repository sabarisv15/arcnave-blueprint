# RESULT

## Files changed
- `backend/package.json` (+docx, +jszip devDependency)
- `backend/src/generators/wordGenerator.js` (new)
- `backend/src/services/reportService.js` (`GENERATORS.docx`)
- `backend/tests/report-service.test.js` (docx cases; fixed the
  unsupported-format test again — it had drifted from `'xlsx'` to
  `'docx'` last slice, now uses `'pptx'`, which stays genuinely
  unsupported)

## Library: docx, no ADR
Matches TechStack.md's gap by ADR-017/019/excelGenerator.js's own
criteria — expected default, no alternatives weighed, no ADR. `npm
audit` unchanged after install (4 pre-existing vulnerabilities, `docx`
added none). No manual layout math needed (unlike `pdfGenerator.js`):
a docx `Table` wraps/paginates on its own in Word.

Added `jszip` as a **devDependency** (test-only) to unzip generated
`.docx` output for real content verification in the committed test —
`docx` itself has no reader API. `npm audit` unchanged after this too.

## Verification
- Live throwaway script (deleted after use): `format: 'docx'` end to
  end against real DB + filesystem — real zip/docx bytes, unzipped via
  `jszip`, `word/document.xml` confirmed to contain the report title,
  both column headers, and both seeded students' names. 9/9 checks.
- Committed tests: `wordGenerator` output unzipped and its
  `document.xml` checked for real text content (not magic-byte
  sniffing); `reportService`'s `docx` wiring through the real
  generator.
- Full suite: 400/400 (397 + 3 net new).

## Flags
- No API/UI yet.
- Generator Module's tabular lineup is now complete: csv/pdf/xlsx/docx,
  all wired to `student_export`. PPT stays parked (no real ask) —
  confirmed still rejected via `ReportFormatError`.
- Any second report type: still unbuilt.
