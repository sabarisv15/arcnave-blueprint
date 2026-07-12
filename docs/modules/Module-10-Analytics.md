# Module 10 — Analytics

## Second slice: API + UI (closes Module 10)

`GET /api/v1/analytics/attendance-rate` (`backend/src/routes/analytics.js`,
registered in `tenantApp.js`) — a thin wrapper over the first slice's
`analyticsService.getAttendanceRateByClass`, no reshaping. Optional
`?class_id=` query param (snake_case, matching `attendance.js`'s own
convention); `collegeId` is always `req.collegeId`, never a query
param.

**RBAC**: `requireRole('principal', 'hod')`. No existing route in this
codebase combines these two roles — `reports.js`'s writes gate
`principal`-only; `attendance.js`'s reads defer entirely to
`attendanceService`'s own per-actor authorization rule instead of
gating at the route. This endpoint has no service-level authorization
logic of its own (it's a pure aggregate read, not a per-row decision),
so the route itself has to be the real, conservative gate — same
reasoning `reports.js`'s own comment gives for why its routes are
conservative. Both roles are named because both are real consumers:
`PrincipalDashboard.jsx` surfaces it today, and `hod` is included so
`HodDashboard.jsx` can add the same panel later without a second
route change. Ordinary staff have no BusinessRules.md-named need to
see another tutor's class-level attendance rate.

**UI**: one panel added to `PrincipalDashboard.jsx`'s existing
`reports` tab — the only dashboard with a Reports tab today
(`HodDashboard.jsx` has none yet). Reuses the `.data-table`/`badge-*`
CSS classes `LowAttendanceModal.jsx` already established; no chart
library added (none exists in `package.json`, and a table fits a
per-class list this small). A `null` `attendanceRatePercent` (a class
with zero recorded students) renders "No data", not a `0%` badge —
matches the service's own reasoning for returning `null` rather than
`0` in that case.

**Live verification**: real Postgres, HTTP integration test
(`analytics.test.js`) — 401 unauthenticated, 403 staff, 200 principal
and 200 hod (identical data), `class_id` filter narrows to one class,
a tenant with zero `attendance_sessions` gets `200 []`, not an error.
Frontend: `npm run build` clean; no browser session available in this
environment to visually confirm the rendered panel — flagged, not
faked.

## First slice: attendance-rate-by-class (read-only aggregate)

`AnalyticsRepository` + `AnalyticsService`, per Architecture.md 2.5/
2.7. No migration, no new table, no API/UI yet — a pure aggregation
read over existing tables.

### Cross-domain JOIN, confirmed against Architecture.md 2.7
CLAUDE.md rule 4 / Architecture.md 2.7 ("repositories never call other
repositories") governs function-to-function calls between
repositories, not SQL table access within one repository's own query.
`analyticsRepository.attendanceRateByClass` JOINs `attendance_
sessions` (Attendance's table) to `classes` (Academic's table) inside
one query — the same pattern `staffRepository.js`'s
`findByCollegeDepartmentAndRole`/`findByCollegeAndRole` already use to
JOIN `users` (Auth/Platform's table) directly, for the identical
reason: the result genuinely needs both tables' columns, and there is
no existing repository-owned function this could call instead without
an N+1 loop per class. `AnalyticsService` itself never touches a
repository other than `analyticsRepository` — the cross-domain reach
is confined to one query in one repository file, not spread across
the service layer.

### Metric definition
Per class: `SUM(total_students - jsonb_array_length(absent_student_ids))
/ SUM(total_students)` across all non-soft-deleted `attendance_
sessions` rows for that class, as a percentage, rounded to 2 decimal
places. A class with zero recorded students (`totalMarked === 0`)
reports `attendanceRatePercent: null`, not `0` — there is no rate to
report, and `0%` would misleadingly read as "everyone was absent."

Rule 7 (attendance locked behind `timetable_status == 'Approved'`) is
**not** re-checked here: it is already enforced at write time by
`attendanceService.assertTimetableApproved` (Module 4) — a row's mere
existence in `attendance_sessions` already proves it was marked
against an approved timetable. Re-filtering by `timetable_status`
here would be redundant, not defense in depth (unlike RLS, which *is*
re-enforced per query since it's a different failure mode — a missing
`app.current_tenant` — not a business rule already checked upstream).

### RLS
No new table, so no new migration/policy. Both `attendance_sessions`
(Module 4 migration) and `classes` (Module 3 migration) already carry
their own `tenant_isolation` policy — a JOIN between two RLS-scoped
tables can never cross a tenant boundary, same reasoning
`classRepository.js`'s globally-unique-key lookups give for relying on
RLS alone rather than duplicating a redundant explicit filter. Proven
live in `analytics-service.test.js`, not just assumed: two tenants
seeded, tenant B's classes never appear in tenant A's aggregate.

### Live verification
Real Postgres, two tenants seeded directly via the admin pool, real
`arcnave_app`-role tenant-scoped transaction (`BEGIN` +
`set_config('app.current_tenant', ...)`), same discipline
`rls-tenant-isolation.test.js` uses:

| Proof | Result |
|---|---|
| Two-session class rate computes correctly (77/80 present = 96.25%) | passed |
| Single-session class at 100% | passed |
| Soft-deleted session excluded from the aggregate | passed |
| `classId` filter narrows to one class | passed |
| Cross-tenant isolation — tenant B's classes never leak into tenant A's result | passed |
| A class with zero attendance_sessions is simply absent from the result (no null-filled row) | passed |

Full backend suite re-run after: no regressions (see `.ai/RESULT.md`
for the exact count).

## Known gaps / deferred

- **No HOD dashboard panel yet.** `requireRole` already permits `hod`,
  but `HodDashboard.jsx` has no Reports-equivalent tab to place it in
  today — the route is ready; the second dashboard's panel is a
  follow-up.
- **Finance metrics skipped.** More sensitive than attendance;
  deferred until this pattern (repository aggregate + service-level
  rate math + RLS-via-JOIN) is proven once, here, first.
- **No time-window filtering.** The aggregate is all-time across every
  non-deleted session for a class — no `dateFrom`/`dateTo` narrowing
  yet (e.g. "this semester's rate"). Not needed by any real consumer
  yet.
- **No per-student breakdown.** This slice only aggregates to
  class-level sums — `attendance_sessions`' own per-period grain (not
  per-student) means a per-student rate would need a materially
  different query, deferred until a real screen asks for it (same
  "don't build ahead of a known consumer" reasoning
  `attendance-sessions-schema`'s own migration comment gives for not
  normalizing to a per-student table).
