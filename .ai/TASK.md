# TASK

## Objective (Module 10 — Analytics, first slice)
Read-only aggregation over existing tables. No new source-of-truth
data, no migration, no API/UI yet.

## Decisions
- `AnalyticsRepository` + `AnalyticsService` only — Architecture.md
  2.7's "repositories never call other repositories" governs
  function-to-function calls, not SQL table access; `staffRepository`
  already JOINs `users` (a different domain's table) directly for the
  same reason this slice needs to JOIN `classes` from `attendance_
  sessions` — same precedent, not reinvented.
- Metric: attendance-rate-by-class — `SUM(total_students -
  jsonb_array_length(absent_student_ids)) / SUM(total_students)` over
  `attendance_sessions`, grouped by `class_id`, joined to `classes`
  for `class_name`. Rate math (division, rounding) is
  AnalyticsService's job — repository returns raw sums only.
- No explicit `timetable_status = 'Approved'` filter needed: rule 7 is
  already enforced at write-time (`attendanceService.assertTimetable
  Approved`), so a row's mere existence in `attendance_sessions`
  already proves it was marked against an approved timetable.
- RLS: no new table, so no new migration/policy — both
  `attendance_sessions` and `classes` already carry `tenant_isolation`
  policies (Module 4 / Module 3 migrations), same shape as Module 9's
  `ai_document_chunks`. Rely on RLS for tenant scoping in the JOIN,
  same as `classRepository`'s globally-unique-key lookups do.
- Skip Finance metrics this slice (more sensitive, prove the pattern
  first).

## Files
`backend/src/repositories/analyticsRepository.js`,
`backend/src/services/analyticsService.js`,
`backend/tests/analytics-service.test.js`,
`docs/modules/Module-10-Analytics.md`.

## Verification
Live: real Postgres, two tenants, seed classes + attendance_sessions,
confirm rates compute correctly, confirm cross-tenant isolation (a
class from tenant B never appears in tenant A's aggregate). Full
suite, no regressions.

## Output style
Token-efficient. Final report only: files changed (1 line each),
test/verification results, flags.
