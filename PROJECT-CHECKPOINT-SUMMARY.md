# ARCNAVE Project — Checkpoint Summary

## What this project is
Multi-tenant campus automation SaaS (ARCNAVE Campus OS). Backend:
Node/Express + PostgreSQL. Frontend: React. Built module-by-module
(Module 0 Platform Foundation through Module 10 Analytics), each
module built vertically (DB → repository → service → API → UI →
tests). See CLAUDE.md and docs/architecture/ for full rules.

## Where things stand (as of this checkpoint)
- All 10 roadmap modules (0–10) built and live-verified.
- Original 10-item post-launch punch list: closed (RBAC permission
  model, notification ledger UI, SMS/WhatsApp dispatch, R0-R5 risk
  ladder + Action Manifest, CSV timetable import fix, template mime
  validation, upload→merge→re-upload, HOD dashboard panel, time-window
  filtering, per-tenant AI provider config).
- Notification system rebuilt: channel/provider split
  (email/sms/whatsapp folders, provider-agnostic), MSG91 (SMS), Meta
  Cloud API (WhatsApp), college_notification_channels config table
  with encrypted per-college credentials. WhatsApp OTP for phone
  verification. "Send Alert" feature (tutor → own class, WhatsApp,
  documented WorkflowService-bypass exception).
- Student create/update/delete scoping: staff creates (own class
  only), staff/hod/principal can all update/delete (own class/
  department/college respectively).
- Full access-leak audit round completed: student reads, finance
  reads, documents/OCR reads, attendance reads, faculty-allocation
  reads, classes reads, staff reads, configuration reads, background-
  job reads — all scoped via a shared `visibilityService.js`.

## Backup / checkpoint taken
- Git tag `pre-cleanup-checkpoint` → commit `2ccda4d`.
- Note: working tree was NOT clean when this tag was made — pending
  work at the time was committed first (`2ccda4d`), then tagged. So
  this tag is a rollback point AFTER that pending work, not before it.
- Cleanup (removed 3 unreferenced stray files: `git`,
  `module-08-kickoff-prompt.md`, `module-10-kickoff-prompt.md`) landed
  separately as commit `daa664f`, after the tag.
- To roll back to this checkpoint: `git reset --hard pre-cleanup-checkpoint`
  (loses anything committed after `2ccda4d`, including the cleanup
  commit `daa664f` — recommit cleanup manually if rolling back).

## Flags to check (pending, not yet executed)

### Architecture refactor (planned, not started)
1. **ActorContext** — replace scattered `(user, role, department,
   tenant...)` params with one immutable resolved object per request
   (`actorId, tenantId, permissions[], scopeLevel, departmentIds[],
   assignedClassIds[], campusIds[]`), built once via middleware, passed
   as `(actorContext, resource)` to every service. Not yet built.
2. **Scope-level model** — decouple role names from access reach.
   Introduce `self_assigned` / `department` / `college` scope levels;
   roles map to a scope level via a role→scope table instead of
   hardcoded `if (role === 'hod')` branches scattered per service.
   Enables adding future roles (Vice Principal, Academic Coordinator,
   Dean) without touching authorization logic. Not yet built.
   Recommended build order: ActorContext first, then scope-level model
   on top of it, then the 5 leak fixes below built on the new
   foundation (avoids redoing the fixes twice).

### Confirmed real leaks — fixes drafted, not yet executed
3. **AI document search (RAG) leak** — `documentSearchService
   .searchDocuments` / `aiDocumentChunkRepository.search` filter only
   by college + classification, no department/class scoping. HOD or
   college_admin can retrieve sensitive student documents (certs,
   photos) outside their own department via AI search, bypassing the
   scoping already enforced on `GET /documents`.
4. **HOD attendance-marking leak** — `attendanceService.js`
   `assertCanMark` grants marking on `role === 'hod'` alone, no
   department check. Any HOD can mark attendance for any class in the
   college, not just their own department. (Read-side was already
   fixed; write-side was not.)
5. **HOD analytics leak** — `GET /analytics/attendance-rate` lets HOD
   query any class_id in the college, no department check.
6. **Approval-submission ownership gap** — `POST /finance/fee-
   structures/:id/submit-approval` (`requireAuth` only) never verifies
   the actor owns/created the fee structure being submitted for
   approval.
7. **Fee-marking scope gap (design decision made, not yet built)** —
   `markFeePayment` and other fee-write actions are currently
   principal-only with zero service-layer scope check. Confirmed
   decision: open this up to tutor (own class) / hod (department) /
   principal (college), same as every other module — needs the same
   scope-check pattern added before broadening the permission mapping.

### Lower-priority, noted but not required
8. `finance.test.js` / `students.test.js` (live-DB integration tests)
   were not updated for the most recent scoping batch — needs a run
   against a real Postgres + CI verification before considering that
   batch fully proven.
9. Soft-deleted students: `roll_no` isn't freed for reuse (no partial
   unique index) — known, low-priority, undocumented as a fix target.
