# ADR-022: Identity Resolver Contract

Status: Accepted

## Decision
`services/identityService.js` is the one public façade over the new
Position/Institutional Position Account/Occupant model (ADR-021).
Routes, AI tools, and `workflowChainService` (Phase 5) must only ever
require this file — never `services/identity/*Resolver.js` directly,
and no resolver module may call another resolver module. This mirrors
CLAUDE.md's "repositories never call other repositories" one layer up,
per the migration plan's "Service architecture decision: identityService,
internally split."

## Public contract (frozen)

### `identityService.resolveCapabilities(client, { userId, collegeId })`
The one entry point. Returns:

```
{
  userId: string,
  collegeId: string,
  positions: [
    {
      positionId: string,
      level: number,               // 1-4
      title: string,
      positionAccountId: string,
      currentOccupantUserId: string | null,
      moduleKeys: string[],        // position_module_assignments, active only
      departmentIds: string[],     // position_department_assignments, active only
    },
  ],
  effectiveRole: 'principal' | 'hod' | 'staff',
  scopeLevel: 'college' | 'department' | 'self_assigned',
  departmentIds: string[],         // visibility scope's own department set
  assignedClassIds: string[],      // only populated for scopeLevel = 'self_assigned'
}
```

- Never throws for "no active position" — that is the ordinary
  person-centric (Level 4 / plain staff) case, resolved as
  `effectiveRole: 'staff'`, `scopeLevel: 'self_assigned'`. Only a
  genuine DB error propagates.
- `effectiveRole` exists solely so a caller comparing against the
  legacy `users.role` string (shadow mode, and eventually Phase 6's
  cutover) has something directly comparable — it is a derived label,
  not a stored value anywhere in the new schema. Derivation: an active
  Level 1 position → `'principal'`; else an active Level 3 position →
  `'hod'`; else → `'staff'`. A position holding both is treated as
  Level 1 (lower level number wins), though nothing in Phase 1-3
  actually produces that state today.
- `positions` is a list, not a single value, because nothing in the
  schema forbids a person from occupying more than one position at
  once — callers that need one "primary" position apply their own
  tie-break (this façade's own `effectiveRole` derivation is the
  reference tie-break: Level 1 outranks Level 3).

## Internal resolver modules (not part of the public contract)
Composed by the façade only; each is a plain-function module under
`services/identity/`, independently unit-testable, never calling
another resolver:

- **`positionResolver.resolveActivePositions(client, { collegeId, userId })`**
  — `user_id` → every position they actively occupy (via
  `position_occupants`), joined through `position_accounts` to
  `positions`.
- **`moduleResolver.resolveOwnedModules(client, positionId)`** —
  position → active `position_module_assignments.module_key` list.
- **`departmentResolver.resolveMappedDepartments(client, positionId)`**
  — position → active `position_department_assignments.department_id`
  list.
- **`assignmentResolver.resolveCurrentOccupantUserId(client, positionAccountId)`**
  — position account → current active occupant's `user_id`, or `null`.
- **`visibilityResolver.resolveVisibilityScope(client, { userId, positions, resolveDepartmentIds })`**
  — replicates `actorContextService.js`'s role → scope-level logic
  (Level 1 → `college`, Level 3 → `department` [scoped to that
  position's mapped departments], no active Level 1/3 position →
  `self_assigned` [with `assignedClassIds` computed exactly as
  `actorContextService.resolveAssignedClassIds` does — tutor-of-record
  class + faculty-allocated classes, since that data is genuinely
  person-centric, not position-centric, per ADR-021's own "Level 4 is
  not part of this account model" line]). Level 2 positions
  deliberately have no scope mapping yet — v1 leaves Level 2
  configurable per-college by Level 1, so there is no single fixed
  answer; assigning one is real Phase 5/6 policy work.

These signatures are internal implementation detail, not frozen by
this ADR — they may change freely as long as `resolveCapabilities`'s
own contract above doesn't. Phase 5/6 code must never depend on them
directly.

## What is explicitly NOT in scope of this contract
- No enforcement semantics — `resolveCapabilities` only resolves facts,
  it never decides "is this allowed." `permissions.js`/`aiToolRegistry.js`
  (Phase 6) and `workflowChainService` (Phase 5) are the callers that
  turn these facts into a decision.
- No caching — every call re-reads the DB through the given `client`
  (normally the request's own transaction connection). A cache
  strategy is deliberately deferred to ADR-026, written once
  `identityService` is a real production hot path.
- No write path — every resolver here is read-only. Reassignment,
  module/department (re)assignment, and any other mutation belongs to
  Phase 7 (occupant reassignment lifecycle) and the positions
  create/edit flows (Phase 4), never to this façade.

## Why frozen now (Phase 3 checkpoint)
Per the migration plan's "Checkpoint — resolver contract freeze": once
Phase 3 is stable, `identityService`'s public interface must be treated
as frozen before Phase 5 (workflow routing cutover) and Phase 6
(RBAC/AI tool cutover) start in parallel — otherwise both workstreams
would depend on, and independently reshape, the same interface at the
same time. This ADR is that freeze point, written after the resolver
was actually built and shadow-verified (see Consequences), describing
what was built rather than a prior design intent.

## Verification behind this freeze
- `identity-resolvers.test.js`: unit coverage for all five internal
  resolvers plus the composed façade, against real seeded position
  data (positions/accounts/occupants/module and department
  assignments), including the "no active position → staff/
  self_assigned, not an error" case.
- `identity-shadow-enforced.test.js`: end-to-end proof, with
  `IDENTITY_SHADOW_MODE=true` against a real backfilled test college —
  zero mismatches across the four routes enrolled in shadow comparison
  (`GET /college-profile`, `GET /departments`, `GET /ai-config`,
  `GET /background-jobs`) — and proof that a LEGACY (not-yet-backfilled)
  college is never enrolled even with the flag on.
- Full existing suite (1167 tests, pre-Phase-3) passes unchanged with
  the flag at its real default (off) — zero behavior change to any
  existing route.

## Alternatives considered
- **Five separately-callable services** (`PositionResolver`,
  `ModuleResolver`, etc. each its own top-level service): rejected —
  would let identity logic scatter across call sites the way
  `permissions.js` currently scatters role checks across 22+ files,
  and conflicts with CLAUDE.md's "every AI tool calls a Business
  Service" (singular). See the migration plan's own "Service
  architecture decision" section for the full reasoning.
- **One monolithic `identityService` with no internal split**:
  rejected — risks becoming a God Service as visibility, module,
  department, and assignment logic all pile into one file, and makes
  Phase 5/6 parallel ownership harder (different engineers can't
  cleanly own different resolver modules).

## Consequences
- `services/identityService.js` and `services/identity/*Resolver.js`
  exist and are shadow-verified against a real backfilled college.
- `middleware/identityShadow.js` + `services/identityShadowService.js`
  + `identity_migration_mismatches` (migration
  `1757200000000_identity-migration-mismatches.js`) give Phase 3 its
  required mismatch-logging pipeline (Observability & monitoring's
  "Mismatch reporting" requirement).
- Phase 5 (`workflowChainService`) and Phase 6 (RBAC/AI tool cutover)
  may now build directly on `resolveCapabilities`'s frozen shape above.
- This session's shadow enrollment (`IDENTITY_SHADOW_MODE`, four
  low-risk GET routes) has NOT yet run for a real, sustained
  production observation window — per the migration plan's own Phase 3
  exit criteria ("production observation period complete" before
  moving a college `BACKFILLED → SHADOW`), no college's
  `migration_state` was moved to `SHADOW` in this session. That
  transition is a calendar/process step for a later session, not
  something this implementation pass can honestly claim to have
  fulfilled.
