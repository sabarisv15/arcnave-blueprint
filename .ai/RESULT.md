# RESULT

## Files changed
- `backend/package.json` (+exceljs)
- `backend/src/generators/excelGenerator.js` (new)
- `backend/src/services/reportService.js` (`GENERATORS.xlsx`)
- `backend/tests/report-service.test.js` (xlsx cases; fixed the
  now-stale unsupported-format test, previously asserting on `'xlsx'`
  itself — now uses `'docx'`)

## Library: exceljs, no ADR
Matches TechStack.md's gap by ADR-017/019's own criteria (pure JS, no
native deps) — the expected default, not a deviation, so no new ADR.
`sheet.columns`' `key` maps straight onto ReportModel rows' own keys —
no manual per-cell extraction needed, unlike csv/pdf.

One flagged, accepted gap: exceljs@4.4.0 (latest) transitively depends
on a `uuid` version with a moderate advisory (buffer-bounds check, only
reachable if a caller passes uuid an explicit buffer — exceljs
doesn't). `npm audit fix --force` only offers downgrading to
exceljs@3.4.0, a worse outcome. Not fixed; noted in
`excelGenerator.js`'s own comment.

## Verification
- Live throwaway script (deleted after use): `format: 'xlsx'` end to
  end against real DB + filesystem — real zip/xlsx bytes on disk,
  re-opened via `ExcelJS.Workbook.load` (not just magic-byte sniffing),
  header + both seeded students' rows confirmed. 7/7 checks passed.
- Committed tests: `excelGenerator` output re-read via exceljs itself
  (exact header/row values, plus the 31-char sheet-name truncation);
  `reportService`'s `xlsx` wiring through the real (unmocked)
  generator.
- Full suite: 397/397 (393 + 4 net new).

## Flags
- No API/UI yet.
- Word generator, any second report type: still unbuilt.
- `student_export` is now the only report type wired to all three
  formats (csv/pdf/xlsx) — the full 2.6 Generator Module lineup this
  slice's scope covers.
