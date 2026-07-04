# RESULT

## Files changed
- `backend/src/services/workflowService.js` (+`getRequest`, plain read)
- `backend/src/routes/workflowRequests.js` (new — pending/approve/reject)
- `backend/src/routes/staff.js` (+`POST /staff/:id/submit-registration`)
- `backend/src/routes/finance.js` (+`POST /finance/fee-structures/:id/submit-approval`)
- `backend/src/tenantApp.js` (+router registration)
- `frontend/src/pages/HodDashboard.jsx`, `frontend/src/pages/PrincipalDashboard.jsx`
  (new "Pending Approvals" tab; Principal also gets a "Staff
  Registrations" section + a Fee Structures "Submit for Approval" button)
- `docs/modules/Module-08-Workflow-Notifications.md` (closes the module)

## What was built
**Routes**: `GET /workflow-requests/pending` (thin
`listPendingForApprover` wrapper, `requireAuth` — the query itself is
the authorization boundary). `POST /workflow-requests/:id/approve`/
`:id/reject` **dispatch by `entity_type`**: `staff_registration` →
`staffService.approveStaffRegistration`/`rejectStaffRegistration`;
`fee_structure` → `financeService.approveFeeStructure`/
`rejectFeeStructure`; anything else → `workflowService` directly. Asked
the user directly whether a bare `workflowService`-only route was
acceptable given it would silently skip the real entity cascades
(fee status flip, staff activation) — user chose dispatch. `POST
/staff/:id/submit-registration` and `POST
/finance/fee-structures/:id/submit-approval` wire the two
previously-unreachable submit functions; both `requireAuth`, not
`requireRole('principal')`, to avoid deadlocking ADR-005 against the
single-principal case.

**UI**: "Pending Approvals" tab (generic list, Approve/Reject) on both
dashboards. Principal additionally gets "Staff Registrations" (submit
trigger, using a new `realStaffList` fetch — deliberately separate
from the existing dead-endpoint `staffList` the legacy Staff
Directory/Edit modal still uses) and a "Submit for Approval" button on
the existing Fee Structures list.

## Real interaction found live (browser click-through, not by inspection)
Staff/fee-structure `create` is still gated `requireRole('principal')`
(unchanged, pre-existing), and Principal is always a resolved approver
in both chains. A Principal who both creates AND submits the same
record 403s trying to approve it themselves (ADR-005) — correct
behavior, surfaced cleanly via a toast, not a crash. Recoverable:
`rejectRequest` has no self-check, so the same Principal can withdraw
their own submission and have a different account resubmit. Added a
visible warning caption on both submit surfaces; documented as a real,
unfixed gap in Module-08's own doc (fixing it means revisiting the
create routes' RBAC, out of this slice's "no new service logic" scope).

## Verification
Full backend suite: 430/430, no regressions. A real HTTP round-trip
script (one-off, deleted after use) proved: submit, wrong-actor 403,
step advance (HOD list → Principal list), terminal cascade (staff_code
assigned, `users.is_active`/`activated_by` real), fee structure
`status` actually flipping, self-approval 403 through the dispatch
route, duplicate-submit 409, reject path. Then a real browser: a
standalone backend (`PORT=5000`) + the real Vite dev server, driven
with headless Chrome (`playwright-core`, scratch-installed for this one
verification pass only — not added to this repo's dependencies) through
the actual login flow and UI — this is how the RBAC/self-approval
interaction above was actually found, not predicted in advance.
Screenshots confirmed the toast messages, the list moving between
HOD's and Principal's queues, and the "Staff Registrations" row
disappearing once `staff_code` was really assigned. `console` free of
runtime errors at every step. Frontend production build clean both
before and after the fix.

## Flags
- The create-route-RBAC / ADR-005 interaction above — real, recoverable,
  not fixed this slice.
- No orchestration linking create → submit into one flow; a Principal
  must switch tabs to submit after creating a record.
