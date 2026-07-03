# ADR-008: Dedicated Generator Module (not inline in ReportService)

Status: Accepted

## Decision
Excel/PDF/Word/CSV/Chart generation lives in its own module
(`generators/`) as pure functions, not inside `ReportService`.

## Alternatives considered
- **Generation logic inside ReportService**: rejected. ReportService's
  job is business orchestration (which data, which filters, which
  template) — not document rendering. Mixing the two means every new
  output format (PowerPoint, HTML, dashboard widget) requires editing
  ReportService itself.

## Reasoning
`ReportService` returns a plain `ReportModel` (title, columns, rows,
metadata) — no format-specific code. Generators consume a
`ReportModel` and produce bytes; they have no database access, no
storage access, no business rules, no permissions. Adding a new
output format later means adding a new generator, with zero changes
to `ReportService`.

## Consequences
- Flow: `ReportService → ReportModel → Generator → bytes →
  DocumentService → Storage`. Generators never call DocumentService
  or Storage directly — that would violate "DocumentService is sole
  file owner" (ADR-009).
