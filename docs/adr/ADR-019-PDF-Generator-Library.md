# ADR-019: pdfkit for the PDF Generator (2.6)

Status: Accepted

## Decision
`backend/src/generators/pdfGenerator.js` uses `pdfkit` to produce PDF
bytes from a `ReportModel`. Resolves TechStack.md's named gap ("Node
equivalent of ReportLab, exact library not chosen yet").

## Alternatives considered
- **pdf-lib**: pure JS/TS, no native deps — a real contender, but
  lower-level (no flowing text layout; every string needs manual
  width/position math even for the simple title+table this generator
  draws). More code for the same result, no offsetting benefit here.
- **jsPDF**: browser-first; Node support exists but is the secondary
  target, not the primary one — this is a server-only Generator
  (ADR-008), so a library that treats Node as first-class is the
  better fit.
- **A native/binary renderer (e.g. wkhtmltopdf, headless Chrome via
  Puppeteer)**: rejected outright — adds a system dependency/binary to
  the Docker image for what's currently a plain tabular export;
  disproportionate to the actual need.

## Reasoning
Same criteria ADR-017 used for storage: pure JS, no native compilation
step (keeps the Docker build ADR-016 simplified unchanged), and the
most widely adopted option in the Node ecosystem for exactly this job
— building a document top-down with text/positioning primitives,
matching what a simple report (title + a header row + data rows) needs
without pulling in a heavier HTML-to-PDF pipeline.

## Consequences
- `pdfGenerator.generate` returns `Promise<Buffer>` (pdfkit is
  stream-based) — `csvGenerator.generate` was made `async` too
  (trivially; it does no actual async work) so `reportService.js` can
  `await` either generator identically regardless of format.
- No table/grid layout is built in — this generator draws its own
  fixed-width-column grid manually. Fine for the one report type that
  exists (`student_export`); a real multi-report future might want a
  shared table-layout helper, not built here (nothing but this one
  caller exists yet to design it against).
- Landscape A4, small fixed font: `student_export`'s 22 columns don't
  fit portrait at a readable size. Not a general solution for
  arbitrarily wide reports — flagged, not solved, same restraint
  applied to `STUDENT_EXPORT_LIMIT`'s hardcoded row cap.

## Revisit when
A second report type needs materially different PDF layout (charts,
multi-section documents, page headers/footers) — that's when a shared
layout abstraction earns its cost, not before.
