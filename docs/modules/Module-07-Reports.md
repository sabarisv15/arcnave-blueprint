# Module 7 — Reports

Status: Complete (ledger table → ReportService → 4 generators → API → UI).

## Table
`generated_reports` — append-only ledger, no repository-per-domain-
service (Architecture.md 2.7 exempts it, see ADR-018: same
cross-cutting-ledger category as `audit_log`, not a business domain
any service owns). Real FK to `documents(id)` from day one. No
UPDATE/DELETE grant — a ledger the app role can rewrite isn't a ledger.

## Generator Module (Architecture.md 2.6)
Pure functions, no DB/storage access, shared `ReportModel`
(`{title, columns, rows}`) → `Promise<Buffer>` contract:
- `csvGenerator.js` — matches `CsvExportModal.jsx`'s own
  quoting/BOM convention.
- `pdfGenerator.js` — pdfkit (ADR-019), landscape A4 for 22 columns,
  manual pagination/column-width math (pdfkit has no table layout).
- `excelGenerator.js` — exceljs, expected default (no ADR).
- `wordGenerator.js` — docx, expected default (no ADR); Word's own
  table wrapping needs no manual layout math.

PPT stays parked — no real ask behind it yet.

## Service
`reportService.js` — orchestrates `studentService` data → a
`GENERATORS[format]` map → `documentService.uploadDocument` (storage,
CLAUDE.md rule 2) → `generatedReportRepository` (ledger row). One
report type so far: `student_export`, all 4 formats.

Real bug caught live: writing a `'failed'` ledger row then re-throwing
let the caller's request-transaction rollback erase that same row.
Fixed by resolving with the failed row instead of throwing —
`ReportValidationError`/`ReportFormatError` still throw pre-flight.

Also relaxed `documents.student_id` to nullable this module (separate
migration) — a generated report isn't owned by one student, but bytes
must still route through DocumentService, not around it.

## API
`backend/src/routes/reports.js` — `POST /api/v1/reports/student-export`.
Always `201`; the body's `status`/`error_message` carries the business
outcome, not the HTTP status.

## UI
"Reports" tab in `PrincipalDashboard.jsx` — format dropdown + Export
Students button, downloads via the existing
`documents/:id/download` route reusing `DocumentPanel.jsx`'s
Blob-download pattern.

## Known gaps / deferred
- ~~Only one report type (`student_export`) — attendance/fee reports
  not built~~ — **resolved**: `reportService.js`'s
  `generateAttendanceReport`/`generateFinanceReport` are real,
  repository-backed (`attendanceRepository.list`/`financeRepository.list`/
  `feePaymentRepository.list`), routed via `POST /reports/attendance`
  and `POST /reports/finance` — not stubs.
- Template-fill (bonafide-certificate style: merge data into a stored
  template) is a different capability, belongs to Module 6
  (`DocumentService` template ownership), not started.
- RBAC is the same `requireRole('principal')` placeholder every route
  uses — not a real decision on who may generate reports.
- PPT generator — parked, no real ask.

## Commits
`038f9e2` ledger migration+repo · `1c7993d` ReportService+CSV
(+ `documents.student_id` nullable) · `50294e9` PDF · `243461e` Excel
· `fa58400` Word · `d5472f8` API+UI
