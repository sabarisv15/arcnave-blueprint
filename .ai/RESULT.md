# RESULT

## Files changed
- `docs/adr/ADR-019-PDF-Generator-Library.md` (new)
- `backend/package.json` (+pdfkit)
- `backend/src/generators/pdfGenerator.js` (new)
- `backend/src/generators/csvGenerator.js` (`generate` -> async)
- `backend/src/services/reportService.js` (`format` param, `GENERATORS`
  map, `ReportFormatError`)
- `backend/tests/report-service.test.js` (pdf/format cases)

## Library: pdfkit (ADR-019)
Pure JS, no native deps, most widely used Node PDF library. pdf-lib/
jsPDF/a headless-browser renderer considered and rejected — see ADR.
`npm audit`'s 2 high-severity findings are pre-existing (`node-pg-migrate`'s
dev-only `glob` dependency), unrelated to pdfkit — confirmed via
`npm ls pdfkit` showing no vulnerable subtree of its own.

## Generator contract: both now Promise<Buffer>
pdfkit is stream-based, so `pdfGenerator.generate` returns a Promise.
Made `csvGenerator.generate` `async` too (trivially) so
`reportService.js` awaits either uniformly regardless of format.

## reportService.js changes
`format` is now a parameter (`csv` default). `GENERATORS` map keys
`csv`/`pdf` to `{generate, mimeType, extension}`. Unknown format throws
`ReportFormatError` before touching anything — same "known-value,
service-enforced" shape `DocumentReviewStatusError` already uses.

## Verification
- Live throwaway script (deleted after use): `format: 'pdf'` end to
  end against real DB + filesystem — real `%PDF-` bytes on disk,
  `mime_type: application/pdf`, ledger row `format: 'pdf'`,
  `student_id IS NULL`. 6/6 checks passed.
- Committed tests: `pdfGenerator` produces real PDF bytes and actually
  paginates past one page (verified via the file's own `/Type /Page`
  object count, not assumed); `reportService` rejects an unsupported
  format pre-flight, and a `format: 'pdf'` call correctly uploads
  `application/pdf` bytes via the real (unmocked) generator.
- Full suite: 393/393 (388 + 5 new).

## Flags
- No API/UI yet — still deferred.
- Excel/Word generators, any second report type: still unbuilt.
- pdfGenerator's manual column-grid layout is specific to
  `student_export`'s shape (22 columns, landscape, small font) — not a
  general table-layout abstraction (see ADR-019's Revisit When).
