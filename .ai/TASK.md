# TASK

## Objective (Module 7 — Reports — first slice)
`generated_reports` migration + its own repository only. No
service/API/UI.

## Resolving the 2.7 contradiction (see ADR-018)
Architecture.md 2.7 lists ReportService as having no repository of its
own; 2.8 lists `GeneratedReports` as a dedicated table anyway. Same
shape `audit_log`/`auditLogRepository.js` already has: a cross-cutting
ledger with no owning business-domain service, called directly by
whichever service needs it (not gated behind an "AuditLogService").
`generated_reports` is that same category, not a violation — ADR-018
formalizes it so Module 8 (ApprovalHistory) doesn't re-litigate this.

## Shape decisions
- Checked `CsvExportModal.jsx` (the only real "export" screen) — fully
  client-side, no backend, no persistence at all. Confirms there's no
  existing report-history concept to match; grounds `report_type`/
  `format` as free text (nothing to normalize against yet).
- Append-only, like `audit_log`: no `UPDATE`/`DELETE` grant, no
  `deleted_at`, no `updated_at`. Reasoning: no background-job mechanism
  exists (Architecture.md 3's own named gap), so ReportService's future
  synchronous flow (`ReportModel → Generator → bytes →
  DocumentService → Storage`, ADR-008) means a row's outcome
  (`status`, `document_id`) is already known at the moment it's
  created — no pending-then-updated transition to support.
- `status` (`completed`/`failed`) has no DB default — always explicit
  at insert time, same "no unattended default makes sense" reasoning
  `fee_payments.status` already established.
- `document_id` nullable FK to `documents(id)` — real FK now (unlike
  `fee_payments.receipt_document_id`'s original gap), since
  `documents` already exists. Null on a failed generation.
- `parameters` JSONB NOT NULL DEFAULT `'{}'` — matches
  `configurations.configuration`'s own JSONB convention.

## Files
- `docs/adr/ADR-018-Ledger-Style-Repositories.md` (new)
- `backend/migrations/1752700000000_module-7-reports-schema.js` (new)
- `backend/src/repositories/generatedReportRepository.js` (new)

## Verification
- Live migration up/down/up against `docker-compose` Postgres.
- Throwaway script exercising the repository for real (create incl.
  failed-with-no-document case, findById, list, RLS via `arcnave_app`).
- Full `npm test` regression.
