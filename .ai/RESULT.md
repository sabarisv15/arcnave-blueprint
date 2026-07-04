# RESULT

## Files changed
- `backend/migrations/1752800000000_documents-student-id-nullable.js` (new)
- `backend/src/storage/fileStorage.js` (`studentId` optional)
- `backend/src/services/documentService.js` (`studentId` optional)
- `backend/src/generators/csvGenerator.js` (new)
- `backend/src/services/reportService.js` (new)
- `backend/tests/report-service.test.js` (new)

## Design correction found during live verification
Original plan: on generation failure, write a `'failed'` ledger row
then re-throw. Live-tested and wrong — `generateStudentExportReport`
runs inside the caller's request-scoped transaction; re-throwing lets
the surrounding rollback (every route in this codebase rolls back on a
thrown error) undo the very ledger row the catch block just wrote.
Fixed: on a generation/upload failure (not a `ReportValidationError`,
which still throws before touching anything), the function **resolves**
with the failed row instead — same "return the outcome, don't throw"
contract `markFeePayment` already uses. Documented inline in
`reportService.js`.

## Verification
- Live: migration applied (`documents.student_id` confirmed nullable),
  full `npm test` unaffected (381/381 before this slice's own tests).
- Live throwaway script (deleted after use): happy path — real CSV
  bytes round-tripped through disk via `documentService`, correct BOM/
  header/rows, ledger row `completed` with `document_id` set, stored
  document has `student_id IS NULL`. Failure path — forced
  `studentService.listStudents` to throw, confirmed the function
  resolves (not rejects) with `status: 'failed'`, `document_id: null`,
  `error_message` set. Validation path — missing `collegeId` throws
  `ReportValidationError` before any repository call.
- `report-service.test.js` (mocked, committed): 7 cases covering the
  above plus a `documentService.uploadDocument` failure. `csvGenerator`
  tested directly (pure function, no mocking needed).
- Full suite: 388/388 (381 + 7 new).

## Flags
- No API/UI yet.
- Only `student_export`/CSV this slice — Excel/PDF/Word generators and
  other report types deferred until a real screen needs them.
- `STUDENT_EXPORT_LIMIT = 5000` hardcoded — no real pagination; a
  tenant with more students gets a truncated export (flagged, not
  solved).
