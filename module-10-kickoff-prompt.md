Start Module 10 (Analytics) per Roadmap.md/Architecture.md 2.5/2.7.
Read CLAUDE.md, Architecture.md 2.5 (AnalyticsService: "Aggregated/
derived statistics across other services' data") and 2.7
(AnalyticsRepository), Module-07-Reports.md, Module-04-Attendance.md,
Module-05-Finance.md first.

First slice only: AnalyticsRepository + AnalyticsService, read-only
aggregation queries over existing tables — no new source-of-truth
data, Analytics never owns rows another service already owns (rule 4:
repositories never call other repositories, but AnalyticsRepository
querying other domains' tables directly for read-only aggregates is
the accepted exception Architecture.md 2.7 implies by giving it its
own repository at all — confirm this against 2.7's exact wording
before writing a single query, don't assume). Pick ONE metric set to
ship first — attendance-rate-by-class (`attendance` table, already
locked behind `timetable_status == 'Approved'` per rule 7) — not fee
collection, since Finance's numbers are more sensitive and better
proven second. No API/UI yet — that's a later slice.

Ground the aggregation shape against BusinessRules.md's Attendance
section (what counts as present/absent/on-leave) and
Module-04-Attendance.md's actual schema — don't guess column names or
status enums, read the migration.

Tenant scope: every query RLS-scoped per ADR-002's existing pattern,
same as every other tenant table — check a recent migration (Module 9's
`ai_document_chunks`) for the exact policy shape, don't reinvent it.

.ai/TASK.md -> .ai/RESULT.md, same shape as Module 9's. Verify live
before committing.

Output style: token-efficient. Final report only: files changed
(1 line each), test/verification results, flags.
