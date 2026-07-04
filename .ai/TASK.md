# TASK

## Objective (Module 7 — Reports — final slice)
`POST /api/v1/reports/student-export` (route only, calls
`reportService` directly) + a UI trigger in `PrincipalDashboard.jsx`.
Closes Module 7.

## Route
Matches `finance.js` conventions: `requireResolvedTenant` guard,
`requireRole('principal')` placeholder (same restated caveat every
other write route carries), a `mapReportServiceError` helper
(`ReportValidationError`/`ReportFormatError` -> 400). Body: `{ format }`
(optional, `reportService` defaults to `csv`). Returns the
`generated_reports` row as-is (snake_case, 201 — always a fresh insert,
never an update, regardless of whether `status` comes back `completed`
or `failed`).

No new report-listing endpoint — not asked for, and nothing in this
slice needs a report-history read.

## UI
New sibling tab `'reports'` in `PrincipalDashboard.jsx` (same
card-with-header shape as the `'finance'` tab), icon `Download`
(already imported, unused). Format `<select>` + "Export Students"
button. On click: `POST /reports/student-export` -> if the returned
row's `status === 'failed'`, throw its `error_message` as a toast (same
try/catch/showToast shape every handler in this file uses) -> else
download via `GET /api/v1/documents/:id/download` using the exact
Blob-download pattern `DocumentPanel.jsx`'s `handleDownload` already
established (that route needs a Bearer header, which `<a href>` can't
attach). Filename taken from the response's own `Content-Disposition`
header (a small regex extraction) rather than hardcoded, since the
`generated_reports` row itself carries no filename — only `documents`
does, and fetching that row separately would be an extra round trip
for no reason.

## Files
- `backend/src/routes/reports.js` (new)
- `backend/src/tenantApp.js` (register)
- `backend/tests/reports.test.js` (new, HTTP-level, matches
  `finance.test.js`/`documents.test.js` shape)
- `frontend/src/pages/PrincipalDashboard.jsx` (new tab)

## Verification
- Live: seed a tenant/principal/students, hit the route directly for
  each of the 4 formats, confirm `201` + real `document_id` + a
  downloadable file at `/documents/:id/download`.
- `npm run build` (frontend).
- Headless Chrome screenshot of the running app.
- Full `npm test` regression.
