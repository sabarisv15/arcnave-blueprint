# Module 5 — Finance

Status: Complete (migration → repository → service → API → UI, two
tables: `fee_structures` then `fee_payments`).

## Tables
- `fee_structures` — fee definition (college/academic_year/class/
  category/amount), `status` (`Pending Approval`/`Approved`/`Rejected`
  — no CHECK, service-enforced; BusinessRules: "fee changes require
  approval"). Soft-delete (`deleted_at`), no DELETE grant — fees are
  BusinessRules-named for AI hard-delete prohibition.
- `fee_payments` — manual paid/not-paid flag per (student, fee line),
  not a payment ledger (no amounts/installments this scope).
  `receipt_document_id` started as a bare UUID (no `documents` table
  yet) — got its real FK once Module 6's `documents` table existed
  (landed in `ee46702`, Module 6's service slice).

## Service
`financeService.js` — validation + audit logging over
`financeRepository.js`/`feePaymentRepository.js`, never cross-calling
between them (CLAUDE.md rule 4).

## API
`backend/src/routes/finance.js` — `/api/v1/finance/*`.

## UI
Finance step in `StudentEditorModal.jsx` (mark paid/not-paid,
`e4eb36b`); Fee Structures tab in `PrincipalDashboard.jsx`
(create + list, deliberately no status field — a Principal
self-approving would defeat the pending-approval gate, `6957f02`).

## Known gaps / deferred
- ~~`WorkflowService` approval on fee-structure status changes —
  Module 8.~~ — **resolved**: `financeService.js`'s
  `approveFeeStructure`/`rejectFeeStructure` call real
  `workflowService.approveRequest`/`rejectRequest` (submitted via
  `workflowService.submitRequest`), not a placeholder.
- ~~Student `annual_income` field missing — blocks scholarship
  eligibility~~ — **resolved**: column added (migration
  `1753500000000_student-annual-income.js`), consumed by
  `financeService.js`'s real eligibility calc (~line 504-519).

## Commits
`326e8b5` fee_structures migration+repo · `c1b7aac` fee_payments
migration+repo · `8e5a3d5` service · `77dfcd0` API · `e4eb36b` UI
(profile) · `6957f02` UI (admin)
