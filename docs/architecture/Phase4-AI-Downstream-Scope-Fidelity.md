# Phase 4: AI Downstream Scope Fidelity

**Status: planned in detail, nothing implemented yet.** Follows
directly from Phase 3's own final finding (Group (d)) — Phase 3 made
the AI Policy Gate and the LLM prompt correctly identity-context-aware
(Personal vs. Institutional); this phase closes the one remaining gap,
one layer deeper: the Business Services an AI tool's data actually
comes from.

## Context

`actorContextService.buildActorContext(client, { actorId, tenantId })`
(`backend/src/services/actorContextService.js:26`) is the shared
scope-resolution function `visibilityService.getVisibleClassIds` (and
everything built on it) calls whenever it's handed the legacy
`{actorUserId, actorRole, collegeId}` shape. It **always** calls
`identityService.resolveCapabilities(client, { userId: actorId,
collegeId: tenantId })` — the **Personal** Identity Context resolver —
regardless of what `role` the caller passed in. It never consults
`identityService.resolveCapabilitiesForPosition` (the Institutional
resolver Phase 2 built) at all.

Net effect: an AI tool call from a Position Account (Institutional)
session, once it reaches one of the handful of Business Service
functions that route through this path, silently gets the underlying
human's own Personal scope back, not the Position Account's own
Institutional scope — even though the Policy Gate (Phase 3 Group a)
and the LLM's own prompt (Phase 3 Group c) both correctly know which
context is active.

## Ground truth (confirmed by a full audit of every AI-tool-backing function)

A background audit traced all ~20 functions the AI tool registry calls
into. Only a **small, precise subset** actually reaches
`buildActorContext` — most either do their own independent,
DB-verified lookup (never touching `buildActorContext`), or have no
per-department/class scope narrowing at all (college-wide, nothing to
get wrong).

| AI tool | Backing function | Status | Reason |
|---|---|---|---|
| `attendance_summary`, `students_low_attendance` | `analyticsService.getAttendanceRateForActor` | **Needs fix** | Directly destructures `{actorUserId, actorRole, collegeId}` and forwards it into `visibilityService.getVisibleClassIds` (`analyticsService.js:60-61`) — no dual-input support. |
| `assessment_marks_summary` | `assessmentService.listMarksForActor` | **Needs fix** | Same direct-forward pattern (`assessmentService.js:200`). |
| `academic_class_timetable` | `academicService.getClassTimetableForActor` | **Needs fix** | Same direct-forward pattern (`academicService.js:1245`). |
| `search_documents`, `resolve_document_destination` (data returned, not the resolver itself) | `documentSearchService.searchDocuments` | **Needs fix** | Same direct-forward pattern (`documentSearchService.js:266-270`). |
| `students_roster` | `studentService.listStudents` | **Partial — needs fix** | The `staff` branch (`studentService.js:571`) forwards into `getVisibleClassIds` the same way; the `hod` branch (`studentService.js:582`) already uses its own independent `staffService.findHodDepartmentId` lookup, unaffected. |
| `staff_roster` | `staffService.listStaffForActor` | Safe | `hod`/`principal` branches use their own independent `findHodDepartmentId` lookup or college-wide read — never calls `buildActorContext` (`staffService.js:430-438`). |
| `mark_attendance_nl` | `attendanceService.markAttendanceByRollNumbers` | Safe | Resolves the actor's own real timetable allocation directly (`facultyAllocationRepository.findByStaffUserId`) — never calls `visibilityService`. |
| `assessment_record_mark` | `assessmentService.recordMark` | Safe | Verifies via `assertIsAssignedFaculty` against the real faculty allocation, not role-derived scope. |
| `students_update_profile` | `studentService.updateStudent` | Safe | Verifies via `assertCanModifyStudent` (its own real tutor/HOD assignment check), never `buildActorContext`. |
| `staff_update_profile` | `staffService.updateStaff` | Safe | No scope branch of any kind — principal-only at the route/RBAC layer, not here. |
| `list_calendar_events`, `calendar_create_event`, `calendar_update_event` | `calendarService.*` | Safe | College-wide, no actor param, nothing to narrow. |
| `finance_status_summary`, `finance_record_payment`, `finance_draft_fee_structure` | `financeService.*` | Safe | College-wide or single-record-by-id; no role-based scope branch. |
| `workflow_pending_summary` | `workflowService.listPendingForApprover` | Safe | Filters directly by the real `userId`, no role/scope resolution at all. |
| `list_institutional_documents`, `get_document_version_history`, `get_document_lineage`, `upload_institutional_document` | `documentService.*` | Safe | College-wide with category/department/year filters; role used only to pick allowed publication statuses, no department/class narrowing. |
| `students_submit_lifecycle_change`, `students_submit_transfer`, `staff_submit_registration`, `academic_submit_timetable_for_approval`, `finance_submit_fee_structure_change` | various `*Service.submit*`/`request*` (L3) | Safe | Approver chains resolve from the **target record's** own department/class, not the caller's role. |

**Scope of this phase: 5 call sites, 4 Business Service functions (+1
partial branch), not a sweep across every service.**

### A second thing the audit surfaced (relevant to the fix, not a separate bug)

`identityContext.scopeLevel` can be `'class'` for an Institutional
Class Tutor session (`identityService.deriveEffectiveRoleAndScopeForPosition`),
a fourth value `visibilityService`'s own `SCOPE_LEVELS` enum
(`SELF_ASSIGNED | DEPARTMENT | COLLEGE`) doesn't have. `getVisibleClassIds`
only branches on `SELF_ASSIGNED`/`DEPARTMENT`/falls through to `[]`
otherwise — so a naive fix that just forwards `identityContext.scopeLevel`
verbatim would silently fail-closed (empty roster) for every Class
Tutor session, the opposite of this phase's own goal. See decision 2.

## The principle

**A Business Service that already has a fully-resolved identity context
must use it, never re-derive a different one from a role string.**
Phase 3 already resolved `req.capabilities` once, correctly, upstream
of every AI tool call (Personal vs. Institutional, whichever is
active). This phase's job is purely plumbing: let that already-correct
answer reach `visibilityService.getVisibleClassIds` unchanged, instead
of the Business Service throwing it away and asking a different
question ("what does this person have, personally?") on its own.

This is NOT the larger, previously-deferred refactor ("rewire every
service to consume `req.capabilities.departmentIds` directly instead
of calling `visibilityService` at all") — that's a bigger, structural
change to a working, correct mechanism. This phase is narrower and
safer: teach the ONE function (`visibilityService`'s legacy-shape
entry point) to skip its own redundant re-resolution when the caller
already did that work, exactly the same dual-input pattern
`visibilityService.js`'s own `isActorContext` check already
established for a pre-built `ActorContext` — just extended to reach
the 4-5 functions that don't use it yet.

## Locked decisions

1. **New helper: `aiActorContext.buildActorContextForIdentity(identityContext)`**
   (same file Phase 3 Group (c) added, `services/aiActorContext.js` —
   already the AI layer's one place for "turn `identityContext` into
   something else the app understands"). Pure, synchronous, no DB
   call: maps `identityContext`'s already-resolved fields onto the
   exact `ActorContext` shape `actorContextService.buildActorContext`
   returns (`{ actorId, tenantId, role, scopeLevel, departmentIds,
   assignedClassIds, campusIds }`), so `visibilityService.isActorContext`
   recognizes it immediately with zero changes to that file.
2. **`scopeLevel: 'class'` maps to `SCOPE_LEVELS.SELF_ASSIGNED`** in
   that same helper, with `assignedClassIds` sourced from
   `identityContext.classIds` — a Class Tutor's Institutional scope
   ("exactly these classes") is functionally identical to a staff
   member's own `self_assigned` scope from `visibilityService`'s
   point of view (both resolve to "here is the exact list of class ids
   this actor may see"); `visibilityService`'s own three-value enum is
   NOT changed or widened — the mapping happens once, in the AI layer's
   own helper, not by teaching `visibilityService` a fourth value.
3. **Each of the 4 affected functions (`analyticsService.
   getAttendanceRateForActor`, `assessmentService.listMarksForActor`,
   `academicService.getClassTimetableForActor`,
   `documentSearchService.searchDocuments`) plus `studentService.
   listStudents`'s `staff` branch gains dual-input support**, mirroring
   `visibilityService.js`'s own existing pattern exactly: accept either
   the legacy `{actorUserId, actorRole, collegeId}` shape (unchanged
   behavior, still used by every non-AI/human-dashboard caller) OR an
   already-built `ActorContext` (detected the same way
   `visibilityService.isActorContext` already detects one — presence of
   a `scopeLevel` key) — and when given the latter, forward it straight
   into `getVisibleClassIds` unchanged, skipping `buildActorContext`
   entirely.
4. **AI tool handlers (`aiToolRegistry.js`) build the `ActorContext`
   once via the new helper and pass it instead of the legacy shape** at
   exactly these 5 call sites — nowhere else in the registry changes.
5. **No changes to any Safe-status function** (per the audit table) —
   confirmed by grep at the end of this phase, the same discipline
   Phase 3's own DoD used for its "downstream services untouched"
   check, now flipped to "only these 5 call sites touched."
6. **Non-AI callers of the 4 affected functions are untouched.** If a
   human-dashboard route also calls e.g. `analyticsService.
   getAttendanceRateForActor` with the legacy shape, its behavior is
   byte-identical to today — dual-input support is additive, not a
   behavior change to the existing path.

## Delivery ordering — 4 groups (mirrors Phase 3's own cadence: one commit per completed group)

**(a) The conversion helper + dual-input support in the 4+1 functions:**
1. `aiActorContext.buildActorContextForIdentity(identityContext)` — new
   pure function, unit-tested directly against a Personal-shaped and
   an Institutional-shaped (including a Class Tutor, `scopeLevel:
   'class'`) `identityContext`, proving the mapped `ActorContext`'s
   `scopeLevel`/`departmentIds`/`assignedClassIds` are correct for
   each, including the `'class'` → `SELF_ASSIGNED` mapping (decision 2).
2. Dual-input support added to `analyticsService.getAttendanceRateForActor`,
   `assessmentService.listMarksForActor`, `academicService.
   getClassTimetableForActor`, `documentSearchService.searchDocuments`,
   and `studentService.listStudents`'s `staff` branch — each accepts
   either shape, forwards an already-built `ActorContext` unchanged.
   Existing tests for the legacy-shape path must stay green unchanged
   (regression proof this didn't touch human-dashboard behavior).

**(b) Wire the 5 AI tool call sites:**
3. `aiToolRegistry.js`'s 5 relevant tool handlers build the
   `ActorContext` via the new helper and pass it in, replacing the
   legacy-shape literal each currently constructs inline.

**(c) Regression + new-behavior tests:**
4. For each of the 4+1 functions: one test proving an Institutional
   (Position Account) identityContext now returns data scoped to the
   Position Account's own department/class(es), not the occupant's
   Personal scope — the concrete, previously-impossible-to-prove claim
   this whole phase exists for. Needs at least one fixture where the
   two scopes genuinely differ (e.g. an HOD Position Account for
   department X, occupied by a person whose OWN personal standing is
   plain `staff` with no department at all) so "it returned X's data,
   not empty/wrong data" is an unambiguous proof, not a coincidence.
5. Existing Personal-session tests for all 5 functions re-verified
   unchanged (same inputs, same outputs) — dual-input support must be
   provably additive.

**(d) HTTP-level verification + cleanup:**
6. Extend `tests/position-account-routes.test.js` (same file/pattern
   Phase 3 Group (d) used) with a real HTTP+DB round trip: an HOD
   Position Account for department X, occupied by a person whose own
   personal standing has NO department, calling `attendance_summary`
   (or `academic_class_timetable`) via `/ai/tools/:name/invoke` and
   getting department X's real data back — the same sharp, "every
   other variable controlled for" proof style Phase 3 Group (d) used.
7. `grep` sweep confirming no Safe-status function (decision 5's own
   list) was touched.
8. Remove any now-dead code this leaves behind (e.g. if a Business
   Service's own inline legacy-shape construction becomes unreachable
   for AI callers specifically) — only if genuinely dead, not a
   speculative cleanup.
9. Full backend suite green.

## Definition of Done

- [ ] No function in the audit table's "Needs fix"/"Partial" rows
      re-derives scope from `actorRole`/`actorUserId` when handed an
      already-resolved Institutional identity context — each uses the
      Position Account's own scope instead.
- [ ] A Position Account session and that same person's Personal
      session, when their scopes genuinely differ (the department-X
      fixture in step 4), return **provably different, individually
      correct** data from the same tool — not just "no crash."
- [ ] Every Safe-status function from the audit table is confirmed
      untouched (grep-checkable diff).
- [ ] Every existing Personal-session test for the 5 affected
      functions passes unchanged — dual-input support is additive, not
      a behavior change.
- [ ] `AI-Governance.md`'s existing note on this gap (added at the end
      of Phase 3) is updated to reflect it's fixed, not still open.
- [ ] Full backend suite green at every step, not just at the end.

## Explicitly deferred (not silently expanded)

- **The larger structural refactor** — every Business Service reading
  `req.capabilities.departmentIds`/`classIds` directly instead of
  calling `visibilityService` at all. Not needed: `visibilityService`
  itself is correct and well-tested; this phase's dual-input addition
  is sufficient to make it receive the right input for AI callers.
- **Non-AI (human dashboard) callers of `visibilityService`/`buildActorContext`.**
  A human always logs in with exactly one identity (there's no
  "Position Account dashboard session" today per Phase 3's own ground
  truth — no frontend UI for it exists), so this specific bug has no
  human-facing manifestation to fix.
- **The three Safe-status functions with their OWN separate identity
  gap** (`resolveActiveClassTutorPosition`, `resolveCurrentSessionForStaff`,
  `assertIsHodOfDepartment` all resolve against the raw `actorUserId`
  rather than any Position-Account-aware identity) — a related but
  architecturally distinct gap the audit surfaced as a side note, not
  in scope here. Revisit only if a real correctness gap surfaces there.

## Verification

`node --test "tests/**/*.test.js"` after every step, same as every
prior phase. The concrete end-to-end proof for the DoD's core claim:
step 6's HTTP-level test (Position Account department-X data vs. the
same person's empty/different Personal scope) — the same "every other
variable controlled for" proof style Phase 3 Group (d) established.
