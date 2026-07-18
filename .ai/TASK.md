# TASK

## Objective (Module 10 — Analytics, second slice, closes Module 10)
`GET /api/v1/analytics/attendance-rate` — thin route over the first
slice's `analyticsService.getAttendanceRateByClass`, plus a dashboard
panel to show it.

## Decisions
- RBAC: `requireRole('principal', 'hod')` — no existing route in this
  codebase combines these two roles, but no route needed this exact
  read/no-side-effect shape either (reports.js's writes gate
  `principal`-only; attendance.js's reads defer to the service's own
  per-actor rule). This route has no service-level authorization logic
  of its own to defer to, so the route is the real gate, same
  conservative-route reasoning reports.js uses — and both roles are
  named because both dashboards (Principal, HOD) are real consumers
  per this slice's own UI brief.
- Query: `class_id` optional (snake_case, matching attendance.js's own
  `?class_id=`); `collegeId` always `req.collegeId` (RLS + tenant
  middleware), never a query param.
- Response: `res.json(rows)` — exactly `analyticsService`'s own return
  shape, no reshaping in the route, per brief.
- UI: one panel added to `PrincipalDashboard.jsx`'s existing `reports`
  tab (the only dashboard with a Reports tab today — `HodDashboard.jsx`
  has none) — reuses the `.data-table`/`badge-*` CSS classes
  `LowAttendanceModal.jsx` already established, no chart library
  (none is a dependency today, and a table fits this shape fine).

## Files
`backend/src/routes/analytics.js`, `backend/src/tenantApp.js` (register),
`backend/tests/analytics.test.js`, `frontend/src/pages/PrincipalDashboard.jsx`,
`docs/modules/Module-10-Analytics.md`, `.ai/TASK.md`, `.ai/RESULT.md`.

## Verification
Live: real Postgres, HTTP integration test covering 401 (no auth), 403
(staff), 200 as principal and as hod, `class_id` filter, empty-data
college (200, `[]`). Full backend suite, no regressions. UI checked
by reading the rendered panel logic against the API's real response
shape (no browser session available in this environment — flag, don't
fake, if that's the case).

## Output style
Token-efficient. Final report only: files changed (1 line each),
test/verification results, flags.
