# RESULT

## Files changed
- `backend/src/routes/reports.js` (new)
- `backend/src/tenantApp.js` (registered)
- `backend/tests/reports.test.js` (new)
- `frontend/src/pages/PrincipalDashboard.jsx` (new `'reports'` tab)

## What was built
`POST /api/v1/reports/student-export` — matches `finance.js`
conventions exactly (`requireResolvedTenant`, `requireRole('principal')`
placeholder, `mapReportServiceError`). Body `{ format }` (optional,
defaults to `csv` inside `reportService`). Always `201` — a fresh
`generated_reports` insert either way; the response body's own
`status`/`error_message` carries the business outcome, not the HTTP
code (restated from `reportService.js`'s own design, `1c7993d`).

UI: new `'reports'` sidebar tab in `PrincipalDashboard.jsx`, same
card shape as `'finance'`. Format `<select>` (csv/pdf/xlsx/docx) +
"Export Students" button. On click: POST the route, throw the
returned `error_message` as a toast if `status === 'failed'`,
otherwise download via `GET /api/v1/documents/:id/download` using
`DocumentPanel.jsx`'s exact Blob-download pattern (that route needs a
Bearer header a plain `<a href>` can't attach). Filename parsed from
the download response's own `Content-Disposition` header — the
`generated_reports` row itself carries no filename, and fetching the
`documents` row separately just for that one field would be a wasted
round trip.

## Verification
- `reports.test.js` (real HTTP + live Postgres + real filesystem): all
  4 formats generate and download real files, default format is csv,
  unsupported format 400s, non-principal 403s, unauthenticated 401s.
  One real Express behavior caught along the way: `res.set('Content-Type',
  'text/csv')` gets `; charset=utf-8` auto-appended for text-ish MIME
  types — fixed the test's assertion to match, not routes/documents.js.
  9/9 passing.
- `npm run build` (frontend): clean, 1511 modules.
- Live smoke: seeded a real tenant/principal/students against the
  actual `docker-compose` Postgres, ran the real dev server, confirmed
  via headless Chrome screenshot the app still renders. No browser-
  automation tooling (Puppeteer/Playwright) is installed in this repo,
  so the click-through itself is proven at the HTTP-contract level via
  `reports.test.js` (the exact requests `handleExportStudents` makes)
  rather than a live click simulation — same substitute every prior UI
  slice in this project has used.
- Full backend suite: 409/409 (400 + 9 new).

## Flags
- **Module 7 (Reports) is now complete end to end**: schema/ledger
  (`038f9e2`) -> `ReportService`+CSV (`1c7993d`) -> PDF (`50294e9`) ->
  Excel (`243461e`) -> Word (`fa58400`) -> API+UI (this commit).
- No report-history list UI/endpoint — not asked for, `generated_reports`
  rows exist but nothing reads them back yet.
- RBAC still the `principal`-only placeholder, restated per every
  other write route in this codebase.
