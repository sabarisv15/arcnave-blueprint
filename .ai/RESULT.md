# RESULT

## Files changed
- `docs/adr/ADR-018-Ledger-Style-Repositories.md` (new)
- `backend/migrations/1752700000000_module-7-reports-schema.js` (new)
- `backend/src/repositories/generatedReportRepository.js` (new)

## What was built
`generated_reports`: tenant RLS, append-only (no `UPDATE`/`DELETE`
grant, no `deleted_at`/`updated_at` — a row's outcome is fully known at
INSERT time since no background-job mechanism exists yet). Real FK to
`documents(id)`, nullable for a failed generation. `status` has no DB
default (always explicit, same as `fee_payments.status`).
`generatedReportRepository.js`: `create`/`findById`/`list` only, no
update/remove — matches the table's own grant.

ADR-018 formalizes why this doesn't violate Architecture.md 2.7:
`audit_log`/`generated_reports` are cross-cutting ledgers with no
owning business-domain service, called directly (same pattern every
service already uses for `auditLogRepository`), not "ReportService's
domain repository." Sets precedent for `ApprovalHistory`/`ChatHistory`
later.

## Verification
- Migration up/down/up against live Postgres; `\d generated_reports`
  confirmed shape, FKs, RLS policy.
- Throwaway script: 7/7 checks passed — completed + failed report
  creation (JSONB round-trip, null `document_id` on failure),
  `findById`, `list` (newest-first), and RLS proven through the real
  `arcnave_app` role (not the admin/bypass role).
- Full suite: 381/381, unchanged (no existing code touched).

## Flags
- No service/API/UI yet — next Module 7 slice.
- `report_type`/`format` stay free text — `CsvExportModal.jsx` (the
  only real export screen) is fully client-side with no backend
  concept to ground a fixed set against yet.
