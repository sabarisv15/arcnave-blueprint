# TASK

## Objective (Module 7 — Reports — fourth slice)
`excelGenerator.js` (2.6, `Promise<Buffer>` contract) + third
`GENERATORS` entry (`xlsx`) in `reportService.js`. No new report types,
no API/UI.

## Library: exceljs, no ADR
Matches TechStack.md's named gap ("Node equivalent of openpyxl") by
the same pure-JS/no-native-deps criteria ADR-017/019 already used —
the expected default, not a deviation, so no ADR (per the task's own
instruction: ADR only if deviating).

One flagged, accepted gap: exceljs@4.4.0 (latest) transitively depends
on a `uuid` version with a moderate advisory (buffer-bounds check,
only reachable if a caller passes uuid v3/v5/v6 an explicit buffer —
exceljs doesn't). `npm audit fix --force` only offers downgrading to
exceljs@3.4.0, worse. Not fixed, flagged in `excelGenerator.js`'s own
comment.

## Files
- `backend/package.json` (+exceljs)
- `backend/src/generators/excelGenerator.js` (new)
- `backend/src/services/reportService.js` (`GENERATORS.xlsx`)
- `backend/tests/report-service.test.js` (xlsx cases; fixed the
  now-stale "unsupported format" test, which used to assert on
  `'xlsx'` itself)

## Verification
- Throwaway script: live DB/filesystem round-trip, `format: 'xlsx'` —
  real bytes stored, readable back via `ExcelJS.Workbook.load`.
- Committed tests: `excelGenerator` output re-read via exceljs itself
  (header + rows match, not just magic-byte sniffing); `reportService`
  xlsx-format wiring through the real generator.
- Full `npm test` regression.
