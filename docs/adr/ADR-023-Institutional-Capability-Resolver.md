# ADR-023: Institutional Capability Resolver (`resolveCapabilitiesForPosition`)

Status: Accepted

## Decision
`identityService.resolveCapabilitiesForPosition(client, { positionAccountId })`
is a second, independent public entry point on the same façade ADR-022
freezes — it does not amend ADR-022's contract, it sits alongside it.
Where `resolveCapabilities(client, { userId, collegeId })` resolves the
**Personal Identity Context** (every position a *person* currently
holds, unioned), `resolveCapabilitiesForPosition` resolves the
**Institutional Identity Context** (exactly one *position account*'s
own scope, never merged with anything else the current occupant holds
elsewhere).

```
{
  positionAccountId, positionId, level, positionType, title, collegeId,
  currentOccupantUserId,
  moduleKeys: string[],
  departmentIds: string[],   // [] unless level 2/3
  classIds: string[],        // [] unless level===4 && positionType==='class_tutor'
  effectiveRole: 'principal' | 'level2' | 'hod' | 'class_tutor' | 'staff',
  scopeLevel: 'college' | 'department' | 'class',
}
```

- Takes a `positionAccountId`, never a `userId` — there is structurally
  no `userId` to union against. A Position Account session's JWT
  carries `sub: positionAccountId`, not a user id, specifically so this
  resolver can't accidentally reintroduce the union
  `resolveCapabilities` performs by design.
- `effectiveRole`/`scopeLevel` are derived by a **small new pure
  function**, not a reuse of `resolveCapabilities`'s
  `deriveEffectiveRole`/`visibilityResolver` logic — reusing those
  would reintroduce the exact cross-position union this resolver exists
  to avoid. Derivation is purely mechanical from the one position's own
  `level` + `position_type`: level 1 → `'principal'`/`college`; level 2
  → `'level2'`/`department`; level 3 → `'hod'`/`department`; level 4
  with `position_type === 'class_tutor'` → `'class_tutor'`/`class`.
  Level 4 with no `position_type` is not a state this resolver is ever
  called for — plain staff never get a `position_accounts` row to log
  into.
- Composes the same internal resolver modules ADR-022 lists
  (`moduleResolver`, `departmentResolver`) plus one new one this phase
  added, `classResolver` (mirrors `departmentResolver` exactly, one
  level down: position → its mapped class via
  `position_class_assignments`) — against **one** position only. Never
  calls another public façade function, and is itself never called by
  `resolveCapabilities` or vice versa; the two entry points are
  siblings, not layered on each other.
- No enforcement semantics, same as `resolveCapabilities` — this
  resolves facts, `middleware/rbac.js`/`aiToolRegistry.js`/
  `workflowChainService` still turn facts into decisions.
- No caching, same as `resolveCapabilities` and for the same reason —
  deferred to ADR-026 once this is a real production hot path, not
  designed in speculatively.
- Read-only, same as `resolveCapabilities` — reassignment and any other
  mutation belongs to `positionAccountInvitationService`, never to this
  resolver.

## Wiring (Phase 2)
`middleware/identity.js` branches on `claims.type`: `'access'` →
`resolveCapabilities(userId)` (unchanged, ADR-022); `'position_access'`
→ `resolveCapabilitiesForPosition(positionAccountId)`. `middleware/
sessionRevocation.js` gets the matching branch, checking
`position_accounts.token_version` instead of `users.token_version` for
a `'position_access'` token. `middleware/rbac.js`'s `requirePermission`
needed no change — it already only reads `req.capabilities.
effectiveRole` regardless of which resolver produced it; `PERMISSION_
ROLES` gained new entries for `'level2'`/`'class_tutor'`.

## Alternatives considered
- **Extend `resolveCapabilities` to accept an optional
  `positionAccountId` and scope its existing union down to one
  position when given one**: rejected — would make one function do two
  structurally different things (union vs. exclusive-scope) behind one
  signature, and risks a caller passing a `userId` by habit and
  silently getting the union back for what should have been an
  exclusively-scoped institutional call. A second named function makes
  the two contexts impossible to confuse at the call site.
- **Reuse `deriveEffectiveRole`/`visibilityResolver` for the
  position-scoped derivation**: rejected — both are person-wide by
  construction (they read `positions: [...]` plural and union across
  it); coercing them to a single-position input would either require a
  fake one-element array (fragile) or a second code path inside the
  same function (defeats the purpose of a frozen, well-understood
  shape). A small dedicated derivation function is cheaper to reason
  about and to keep correct than either.

## Consequences
- `identityService.js` now exports two public entry points, not one —
  `resolveCapabilities` (ADR-022, frozen, unchanged) and
  `resolveCapabilitiesForPosition` (this ADR). Both are façades; no
  caller may reach into `services/identity/*Resolver.js` directly for
  either.
- New internal resolver: `services/identity/classResolver.js`.
- `middleware/identity.js`/`middleware/sessionRevocation.js` branch on
  token `type`, not on which identity context "wins" — the two contexts
  coexist per-session, never merged mid-request.
- Future consumers of the Institutional Identity Context (AI tool
  routing under an Institutional session, position-scoped reporting)
  build against this contract, not against `resolveCapabilities`.

## Verification
- Real integration test (Phase 2 step 5): one person seeded as both an
  HOD and, separately, a Class Tutor — logging into each Position
  Account and asserting `req.capabilities` differs and is scoped
  correctly to only the queried position, never the other. This is the
  concrete proof that the "never unioned" claim above actually holds,
  not just an asserted comment.
- Full existing suite green throughout (`resolveCapabilities`'s own
  ADR-022 shape untouched by this addition).

## Note (Phase 3)
AI (`routes/ai.js`/`aiToolRegistry.js`) is now a consumer of whichever
context this resolver (or `resolveCapabilities`) produced — it reads
`req.capabilities.effectiveRole` generically, never branching on which
of the two resolvers ran. See
`docs/architecture/Phase3-AI-Identity-Context-Integration.md`. This
ADR's own contract is unchanged; AI is simply a new caller.

## Related
- [[ADR-021-Institutional-Position-Account-Model]] — the data model
  this resolver reads from; see that ADR's "Amendments" section for the
  Level 4 `position_type='class_tutor'` carve-out this resolver also
  depends on.
- [[ADR-022-Identity-Resolver-Contract]] — the frozen `resolveCapabilities`
  contract this ADR sits alongside, not inside.
- `docs/architecture/Phase2-Position-Account-Auth-Plan.md` — the full
  delivery plan this resolver was built under (decision 4).
- `docs/architecture/Identity-Architecture.md` §6/§7 — narrative
  description of both identity contexts and the resolution pipeline.
