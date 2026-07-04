# ADR-018: Ledger-style repositories are exempt from "one repo per domain service"

Status: Accepted

## Decision
A small set of tables — `audit_log`, and now `generated_reports` — get
their own standalone repository file despite not appearing in
Architecture.md 2.5's service-ownership table or 2.7's per-domain-
service repository list. Any business service calls them directly
(`auditLogRepository.createAuditLogEntry`,
`generatedReportRepository.create`), the same way every service
already calls `auditLogRepository` without a mediating
"AuditLogService."

## Reasoning
2.7's rule — "one repository per domain service that owns data" —
governs repositories paired with real business logic (StudentService/
StudentRepository, FinanceService/FinanceRepository, etc.). `audit_log`
and `generated_reports` aren't a business domain any service owns;
they're cross-cutting event ledgers every service writes to. Forcing
one through a dedicated service (e.g. inventing `ReportService` just
to wrap `generatedReportRepository.create`) would add a layer with no
business logic of its own, purely to satisfy a rule aimed at a
different problem. `ReportService` itself, once built, still has no
domain repository — it composes other services' data into a
`ReportModel` (2.6/ADR-008), same as 2.7 already says. The ledger row
recording that a generation happened is a different, narrower thing.

## Consequences
- No `UPDATE`/`DELETE` grant on either table — append-only, same
  reasoning `audit_log` already established: a ledger the app role can
  rewrite isn't a ledger.
- Repositories never call other repositories (2.7's rule, unaffected):
  `generatedReportRepository` doesn't call `documentRepository` — a
  service resolves `document_id` before calling `create`.
- Future ledger-shaped tables (`ApprovalHistory`, `ChatHistory` —
  Architecture.md 2.8) should follow this same shape rather than
  re-litigating 2.7 each time.
