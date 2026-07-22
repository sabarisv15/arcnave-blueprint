# Phase 3: AI Identity Context Integration

**Status: planned in detail, nothing implemented yet.** Verified
directly against the current tree (commit `5af90c5`). Phase 2 has
shipped (ADR-021/022/023/024, `resolveCapabilitiesForPosition` proven
stable per its own DoD) — this phase's prerequisite is satisfied.

## Context

AI tool authorization today (`routes/ai.js`, `services/aiToolRegistry.js`
— the "Policy Gate") reads `req.jwtClaims.role`, a raw JWT claim,
directly. It is gated at the route level by `requireAuth`, not
`requirePermission` — the one function that reads
`req.capabilities.effectiveRole`. This means AI was never migrated onto
either identity context: not Personal Identity Context in Phase 1
(which covered authorization/`rbac.js`, workflow routing, visibility,
and audit, but not AI), and not Institutional Identity Context in
Phase 2 (which is scoped to Position Account login itself, not to any
consumer of the identity contexts it exposes).

## The principle (user's framing — get this exact, and note what it deliberately does NOT say)

**Don't make AI office-centric. Make AI identity-context-centric.**

> The AI consumes the active Identity Context. It does not determine
> whether the session belongs to a person or an institutional account.
> Identity resolution is the responsibility of the identity subsystem;
> AI is a consumer of the resolved context.

This is a stronger, more specific statement than "AI should behave
differently for personal vs. institutional logins" — it says AI should
never contain a branch that asks "is this Personal or Institutional?"
at all. That branching already happened upstream, once, in
`middleware/identity.js`, before AI's code ever runs. By the time a
request reaches `routes/ai.js`, there is just *one* resolved capability
object on `req` — AI reads it generically (effective role, scope,
whatever fields it needs) without caring which resolver
(`resolveCapabilities` or `resolveCapabilitiesForPosition`) produced
it, or what kind of entity is behind it.

**Why the wording matters, concretely:** if AI's own code branches on
"Personal vs. Institutional," every *new* institutional entity type
(Library, Hostel, Exam Cell, Placement Office, ...) would need a new
AI-side case added. If AI instead just consumes whatever the active
context resolves to, adding a new institutional entity type is entirely
an identity-subsystem change (a new resolver input, same output shape)
— **the AI architecture doesn't change at all.** This is the same
"one façade, swappable internals" principle ADR-022 already established
for `resolveCapabilities`'s own internal resolvers, just applied one
layer up, at AI's consumption boundary.

Illustration (not a spec AI needs to implement per-case — just what
"the active context" resolves to today for two example logins): a
Principal using their **personal login** gets an assistant reflecting
everything they currently do (Personal Identity Context, the union of
their responsibilities); someone logged into the **Principal Account**
gets an assistant that behaves exactly like the Principal's office and
nothing else (Institutional Identity Context, scoped to that one seat).
AI's code should not need to know which of these it's looking at — only
the identity subsystem does.

## Why this was a separate phase, not part of Phase 2

Phase 2's responsibility was to expose a stable, two-function identity
context API:

- `resolveCapabilities(userId)` → Personal Identity Context (Phase 1).
- `resolveCapabilitiesForPosition(positionAccountId)` → Institutional
  Identity Context (Phase 2, ADR-023).

Now that both exist and are stable, refactoring the AI Policy Gate to
consume the active identity context instead of `req.jwtClaims.role` is
its own body of work — it touches AI authorization, tool routing,
prompt context construction, and tool-scoping (the `allowedRoles` table
in `AI-Governance.md` §8, currently keyed on raw role strings
principal/hod/staff), not the identity subsystem itself.

## Ground truth already confirmed in the repo

Corrects one assumption the original scoping pass made — verify this
before assuming otherwise:

- **`req.capabilities` is already populated on AI routes today** —
  `identityMiddleware` (`middleware/identity.js:28-60`) is mounted
  app-wide in `tenantApp.js:112`, *before* `createAiRouter()`
  (`tenantApp.js:145`), unconditionally for every valid `access`/
  `position_access` claim, regardless of whether the route itself later
  calls `requireAuth` or `requirePermission`. **There is no middleware
  prerequisite step** — `req.capabilities` is sitting there unread, not
  missing.
- `routes/ai.js` builds `actor` at exactly two call sites, identical
  shape, both `requireAuth`-gated: `POST /ai/tools/:name/invoke`
  (line 233) and `POST /ai/ask` (line 255):
  ```js
  const actor = { userId: req.jwtClaims.sub, role: req.jwtClaims.role, collegeId: req.collegeId };
  ```
  `actor` carries only `userId`/`role`/`collegeId` — no department/class/
  scope fields at all today.
- `aiToolRegistry.assertPolicyAllows` (lines 234-272): reads
  `actor.role` twice — `allowedRoles.includes(actor.role)` (line 249)
  and `aiClassificationAccess.permittedClassifications(actor.role)`
  (line 255). A third check, `tool.departmentScoped` (lines 263-271,
  reading `actor.departmentId`), was flagged as "dead code" in this
  plan's first draft — **correction, found during implementation**: it
  is real, deliberately-built infrastructure with its own audited
  failure reason (`describePolicyFailureReason`'s `'department_scope'`
  case, alongside `'role'`/`'classification'`/`'tenant'`) and its own
  dedicated test (`ai-service.test.js:490`, including audit-log
  assertions) — just unused by any *shipped* tool today
  (`departmentScoped: true` isn't set on any real tool definition).
  Kept, not deleted (see decision 6's own correction below).
- `aiClassificationAccess.js`'s `ROLE_CLASSIFICATION_ACCESS` table
  (lines 19-23) is keyed on the same three literal strings
  (`principal`/`hod`/`staff`) as `AI-Governance.md` §8's tables — a
  second place with the identical `'level2'`/`'class_tutor'` gap
  described below.
- **`effectiveRole` gap**: `resolveCapabilitiesForPosition` can produce
  `effectiveRole` values `'principal' | 'level2' | 'hod' | 'class_tutor'
  | 'staff'` (`identityService.js:190-197`) — `'level2'` and
  `'class_tutor'` never appear in any tool's `allowedRoles` array, nor
  in `ROLE_CLASSIFICATION_ACCESS`, anywhere today. An Institutional
  session with either effective role would 403 on every single AI tool
  the moment `actor.role` starts reflecting it correctly — this is not
  a hypothetical edge case, it is the *default* outcome of Group (a)
  below unless Group (b) ships in the same pass.
- **No prompt context exists today, for anyone.** `AGENT_SYSTEM_PROMPT`
  (`aiService.js:54-73`) and `aiPromptSafetyLayer.renderForLlm`'s
  `SAFETY_PREAMBLE` (`aiPromptSafetyLayer.js:76`) are both fixed,
  actor-agnostic strings — the LLM is never told who is asking or what
  scope they have. `actorRole` today only ever reaches
  `auditLogRepository.createAuditLogEntry` (audit trail), never the
  prompt. This makes "tell the model who's asking" a **net-new
  capability**, not a refactor of an existing branch.
- **Tool-scoping today is already correct, but redundant with
  `req.capabilities`.** Representative handlers (`students_roster`,
  `staff_roster` → `staffService.listStaffForActor`,
  `attendance_summary`) forward `{actorUserId, actorRole, collegeId}`
  into Business Services that **re-derive** scope themselves —
  `staffService.listStaffForActor` (`staffService.js:430`) does its own
  `findHodDepartmentId` DB lookup keyed on `actorRole === 'hod'`, not by
  reading `req.capabilities.departmentIds`. This produces the *same
  correct answer* Phase 1 already verified — it just doesn't reuse the
  identity subsystem's own already-resolved scope. See Group (c)'s
  scope decision below.
- **`AI-Governance.md` §8a already exists** (`AI-Governance.md:185-200`)
  — a "planned, not built" placeholder pointing at this file. Group (b)
  below is what closes it out; §8a should be deleted (not left stale)
  once it ships, folded into §8's own notes instead.
- **No frontend UI exists to log into a Position Account at all** —
  confirmed via `grep -rl "position-accounts/login" frontend/src`
  returning nothing. This phase's backend work is verifiable the same
  way Phase 2's own was (direct API calls against a real dev server),
  but is **not reachable through the product UI** until a separate,
  unscoped frontend feature (Position Account login) is built. Not a
  Phase 3 blocker — Phase 2 shipped the same way — but don't expect a
  manual click-through in the current frontend to prove this out.
- Nothing structurally stops a `position_access` token from reaching
  `/api/v1/ai/*` today — `requireAuth` accepts either claim `type`
  (`rbac.js:48`). Today that would silently produce `actor.role ===
  undefined` (since `req.jwtClaims.role` doesn't exist on a position
  claim) and every tool call 403s via `allowedRoles.includes(undefined)`.
  Group (a) is what turns this from an accidental fail-closed into
  correct, intentional behavior.

## Locked decisions

1. **Rename `actor` to `identityContext` at construction and
   throughout the AI layer** — not cosmetic. Reviewer feedback on this
   plan's first draft: "actor" undersold what this object becomes after
   this phase (role, scope, departments, classes, position, and
   whatever future entity types the identity subsystem adds later) —
   calling it an identity context, matching the term this whole
   document and `Identity-Architecture.md` already use for exactly this
   concept, keeps the name honest as it grows. `routes/ai.js` gets one
   shared `buildAiIdentityContext(req)` helper (not `buildAiActor`)
   replacing both inline literals. Since Group (a) already touches
   every read site of the old `actor.role`/`actor.userId` shape at the
   AI layer's own boundary (`aiToolRegistry.assertPolicyAllows`/
   `invokeTool`/`buildActionManifest`, `aiService.js`'s three exported
   functions, `routes/ai.js`), the rename rides along there as a
   mechanical find-replace on lines this step is editing anyway.
   **Corrected during implementation**: individual tool handlers
   (`aiToolRegistry.js` lines 988/1013/1041/1082/1100/1116/1329, and
   ~35 more) keep their own local `actor` parameter name unchanged —
   they receive the same (correct) value positionally either way, and
   renaming ~40 local parameter names with no functional effect would
   have been pure churn, not something this step's own diff needed.
2. **`identityContext` gains scope fields**, sourced from
   `req.capabilities` directly, never re-derived: `departmentIds`,
   `classIds`, `scopeLevel`, and `positionAccountId` (`null` for a
   Personal session). One normalized shape regardless of which resolver
   ran — `resolveCapabilities`'s own `assignedClassIds` (only populated
   for `scopeLevel: 'self_assigned'`) and
   `resolveCapabilitiesForPosition`'s `classIds` (only populated for
   `class_tutor`) map onto the same `identityContext.classIds` field, so
   downstream code never needs to know which shape it came from.
3. **Close the `'level2'`/`'class_tutor'` gap** in both
   `aiToolRegistry.js`'s per-tool `allowedRoles` and
   `aiClassificationAccess.ROLE_CLASSIFICATION_ACCESS` — per-tool
   judgment during Group (b) (see that group's own guidance), not a
   blanket "add both everywhere." **Forward note for a future Phase 5**
   (not this phase, not a blocker here — reviewer feedback, recorded so
   it isn't lost): long-term, `allowedRoles` as a literal-string-array
   ceiling is itself the thing worth outgrowing — AI could instead
   consume `identityContext.moduleKeys`/scope shape directly
   (capability-based, not role-label-based), the same shift ADR-022's
   `effectiveRole` already is a deliberate simplification *of*. Not
   attempted here; Phase 3 still ships label-based `allowedRoles`, just
   fed by `effectiveRole` instead of the JWT.
4. **Prompt context is in scope, and is a structured block, not a
   single prose sentence.** Reviewer feedback on this plan's first
   draft (which proposed one sentence like "You are assisting the HOD
   of Computer Science"): LLMs reason more reliably from structured
   context than embedded prose. The generic function
   (`aiActorContext.describeIdentityContext`, see Group (c)) renders a
   small labeled block —

   ```
   Identity Context
   Role: HOD
   Scope: Computer Science Department
   Institution: <college name>
   Access: Department-level
   Restrictions: Do not answer outside this scope.
   ```

   — derived purely from fields common to both resolver outputs
   (`effectiveRole`, `scopeLevel`, a resolved scope name, `collegeId` →
   college name), followed by the existing natural-language system
   prompt unchanged. Still zero `if (institutional) … else …` inside the
   function — every field is read generically off `identityContext`,
   the *labels* differ by role/scope value, not by which resolver
   produced them.
5. **Downstream Business Service scope re-derivation (`staffService.
   listStaffForActor` etc.) is explicitly NOT rewired to consume
   `req.capabilities.departmentIds`/`classIds` directly in this phase**
   — see "Explicitly deferred" below for why. Group (a)/(b)/(c) are
   sufficient for the principle to hold end-to-end; this is a separate,
   larger optimization with its own blast radius across every AI
   tool's downstream service, not required for correctness.
6. **CORRECTED during implementation — `tool.departmentScoped`'s branch
   in `assertPolicyAllows` is KEPT, not deleted.** Originally planned
   as dead-code removal; found during Group (a) step 1 to be real,
   tested infrastructure (see the Ground Truth correction above), so
   deleting it would have broken `ai-service.test.js:490` and removed
   intentional forward-looking capability for zero reason. Renamed
   alongside everything else (`actor` → `identityContext`), otherwise
   untouched. `identityContext.departmentId` (singular, feeds this
   exact-match check) is derived from the new `identityContext.
   departmentIds` (plural, decision 2) — set only when scope is exactly
   one department (true for any HOD or Class Tutor position), `null`
   otherwise.

## Delivery ordering — 9 steps, 4 groups, one commit each (mirrors Phase 2's own cadence)

**(a) Wire the authorization source — pure swap plus the actor→identityContext rename, no new capability yet:**
1. `routes/ai.js`: replace both `actor` literals with one shared
   `buildAiIdentityContext(req)` helper reading `req.capabilities` per
   decisions 1-2. Rename the `actor` parameter/variable to
   `identityContext` at every read site the swap already touches
   (`aiToolRegistry.assertPolicyAllows`, the tool handlers listed in
   decision 1) — mechanical, bundled with the functional change, not a
   separate pass. **Corrected during implementation**: the rename
   stopped at the boundary/dispatch layer (`routes/ai.js`, `aiService.js`'s
   three exported functions, `aiToolRegistry.js`'s `invokeTool`/
   `assertPolicyAllows`/`buildActionManifest`) — each individual tool
   handler's own local 3rd-parameter name (still `actor`, ~40 handlers)
   was deliberately left alone; renaming a local parameter name with no
   functional effect across every handler would have been pure churn,
   not the "rides along for free" the original decision assumed. The
   *value* flowing into every handler is correct either way — only the
   local name callers happen to use for it differs by layer.
   `assertPolicyAllows`'s `departmentScoped` branch is renamed
   (`actor`→`identityContext`) but KEPT, not deleted — see decision 6's
   own correction.
2. Tests: a real integration test proving `/ai/ask`/`/ai/tools/:name/
   invoke` work identically for an ordinary Personal session (regression
   — same tests that exist today must still pass unchanged) AND now
   also succeed end-to-end for an Institutional (Position Account)
   session with the correct `effectiveRole` — the first real exercise
   of a `position_access` token against `/api/v1/ai/*`.

**(b) Close the effectiveRole label gap — DONE:**

**Correction found during implementation**: `buildActorContext`
(`actorContextService.js`) — the shared scope-resolution path
`visibilityService`/`studentService`/`staffService` all sit on top of —
does not derive scope from a role string at all; it re-resolves the
underlying human's own **Personal** Identity Context from their user id
via `identityService.resolveCapabilities`, ignoring whichever
`identityContext.role` a caller passes in. `constants/roleScopeLevels.js`
(`ROLE_SCOPE_LEVELS`), which this step's first draft assumed was the
load-bearing role→scope mapping to extend for `class_tutor`/`level2`,
turned out to be dead code — nothing calls `resolveScopeLevel` outside
its own file. So this correctness gap is broader than originally
scoped here: **every** Institutional (Position Account) role, not only
`class_tutor`/`level2`, gets the occupant's Personal scope from any
downstream Business Service that re-derives via `buildActorContext`,
not the Position Account's own Institutional scope the Policy Gate
(Group a) now correctly reads. This is the same shape decision 5
already defers ("downstream Business Service scope re-derivation... NOT
rewired... this phase"), just wider than decision 5's own text
describes — left deferred, not fixed here, since fixing it for real
means rewiring every AI-tool-backing service to consume
`req.capabilities` directly, decision 5's own larger, separately-scoped
refactor. `AI-Governance.md` §8 now carries a note recording this as a
real, not hypothetical, tracked item.

3. Audit every tool's `allowedRoles` in `aiToolRegistry.js` plus
   `AI-Governance.md` §8's three tables: for each tool, decide whether
   `'level2'`/`'class_tutor'` should be added, using this guidance —
   grant `'class_tutor'` wherever the tool's scope is already a single
   class the tutor legitimately owns (mirrors why `'hod'` already has
   department-scoped tools); grant `'level2'` only where a college
   currently grants `'principal'` a tool that a Principal-configured
   Level 2 position would also legitimately need (default: don't add it
   speculatively — Level 2's own scope-mapping is still undecided
   product policy per ADR-021, unchanged by this phase). Update
   `aiClassificationAccess.ROLE_CLASSIFICATION_ACCESS` in the same
   pass — same literal-string gap, same file family.
4. `AI-Governance.md`: update §8's tables with the new labels, delete
   §8a (superseded, not left stale — fold its one paragraph of "why"
   into a short note at the top of §8 instead).
5. Tests: for each tool where `'class_tutor'`/`'level2'` was added,
   one test proving that effective role can now call it; for tools
   deliberately left unchanged (e.g. `finance_status_summary`,
   principal-only), one test proving `'class_tutor'`/`'level2'` still
   403s there — a decision this explicit needs a test on both sides,
   not just the positive case.

**(c) Prompt context — tell the LLM who's asking, as a structured block — DONE:**

Shipped as `services/aiActorContext.js`'s `describeIdentityContext(client,
identityContext)`, prepended (via a blank-line join) ahead of the
existing system prompt at all three real LLM call sites in
`aiService.js`: `askAgent`'s tool-selection call (`AGENT_SYSTEM_PROMPT`),
`askAboutTool`'s `renderForLlm` call, and `summarizeToolResult`'s
combined prompt. Branches only on `identityContext.scopeLevel` (college
→ "College-wide"; department → the real department name via
`collegeProfileService.getDepartment`; `self_assigned`/`class` → the
real class name via `academicService.getClass` for exactly one class,
or "N own classes" for several; anything else fails closed to
"Unscoped"/"None") — never on role or which resolver produced the
input, so it cannot itself leak Personal vs. Institutional. A dedicated
test proves the same-office-two-auth-paths case is byte-identical
(the function doesn't read `positionAccountId` at all — the "never
unioned" guarantee lives one layer down, in Group (a)'s own
`identityContext` construction, not here).

`invokeTool` (the no-LLM, direct-invoke path) is untouched — no prompt
is ever built there.
6. New small pure function (decision 4) — e.g.
   `aiActorContext.describeIdentityContext(identityContext)` — takes
   the normalized shape from Group (a) and returns the labeled
   `Role`/`Scope`/`Institution`/`Access`/`Restrictions` block shown in
   decision 4, not a prose sentence. Unit-tested directly against both
   a Personal-session-shaped and an Institutional-session-shaped
   `identityContext`, proving the same function produces correct,
   different field values for each without branching on which one it
   received (internals read `identityContext.scopeLevel`/`effectiveRole`/
   etc. generically, never an `identityContext.positionAccountId ? ...
   : ...` check).
7. Wire it into `aiService.js`'s prompt construction — the structured
   block first, the existing natural-language `AGENT_SYSTEM_PROMPT`/
   `aiPromptSafetyLayer.renderForLlm` `preamble` unchanged and appended
   after it (exact seam decided at implementation time, whichever keeps
   `aiPromptSafetyLayer`'s existing sanitization guarantees intact).
   Existing prompt-safety tests must stay green unchanged; new coverage
   proves the structured block actually appears in what gets sent to
   the LLM.

**(d) Verification:**
8. Two dual-context proofs, not one — reviewer feedback: the original
   draft only compared two *different* offices (HOD vs. Class Tutor).
   Add a second, more precise proof using the *same* office through
   both auth paths:
   - **Different offices** (already planned): one person seeded as both
     an HOD (personal login) and, separately, a Class Tutor (Position
     Account login). Hit `/ai/ask` both ways; assert tool set/
     `effectiveRole`/prompt block differ correctly, and neither leaks
     the other's scope.
   - **Same office, two auth paths** (new): the HOD's own personal
     login (Personal Identity Context — the union of everything that
     person does) vs. that same person logging into the HOD Position
     Account itself (Institutional Identity Context — scoped to
     exactly that one seat, nothing else the person might also hold).
     Assert the two identity contexts are provably different even
     though the underlying human and the underlying office are both
     identical — the sharpest possible proof that "never unioned"
     actually holds, since every other variable is controlled for.
9. Full existing suite green. `AI-Governance.md` §8/§8a reflect the
   shipped state, not the "planned" placeholder. No new ADR needed —
   this phase consumes ADR-022/023's already-frozen contracts, it
   doesn't add a new one; a one-line note in ADR-023's own file noting
   "AI is now a consumer, see Phase 3" is enough if anything.

## Definition of Done

- [ ] `routes/ai.js` builds `identityContext` from `req.capabilities`
      only, for both `/ai/tools/:name/invoke` and `/ai/ask` — zero
      remaining reads of `req.jwtClaims.role` in either route.
- [ ] `grep -rn "jwtClaims.role" backend/src/routes/ai.js
      backend/src/services/aiToolRegistry.js
      backend/src/services/aiClassificationAccess.js
      backend/src/services/aiService.js` returns nothing — reviewer
      feedback: an explicit, automatable check future contributors can
      re-run, not just "we're pretty sure we caught every read site,"
      the same discipline Phase 2's own DoD used for `grep -rn
      tutor_user_id backend/src`.
- [ ] Neither `routes/ai.js` nor `aiToolRegistry.js` contains any branch
      testing "is this a Personal or Institutional session" — the
      principle's own bar, checked by actually reading the diff, not
      just by the tests passing.
- [ ] A Position Account (Institutional) session can successfully call
      at least one AI tool it's entitled to, end to end, proven by a
      real test — not just that the code compiles.
- [ ] `'level2'`/`'class_tutor'` are deliberately present or absent from
      each tool's `allowedRoles`, never merely omitted by oversight —
      every tool has an explicit yes/no captured in the audit (step 3),
      not silence.
- [ ] The LLM receives a real, generically-derived actor-context string
      that differs correctly between a Personal and an Institutional
      session — proven by inspecting the actual prompt sent, not just
      that a function returns a string.
- [ ] `AI-Governance.md` §8 reflects the shipped state; §8a is gone.
- [ ] Full existing suite green at every step, not just at the end.
- [ ] Downstream Business Service scope re-derivation is explicitly
      untouched — grep confirms no `req.capabilities` reads were added
      to `studentService`/`staffService`/`analyticsService`/etc. as part
      of this phase (see "Explicitly deferred").

## Explicitly deferred (not silently expanded)

- **Rewiring downstream Business Services to consume
  `req.capabilities.departmentIds`/`classIds` directly**, replacing
  their own independent role-string-based scope re-derivation
  (`staffService.listStaffForActor` etc.). Deferred because: (1) it's a
  separate, larger refactor touching every AI-tool-backing service, not
  just the AI layer itself — the same kind of scope-mixing Phase 2's
  own delivery ordering deliberately avoided; (2) the current
  re-derivation is not incorrect — Phase 1 already verified it produces
  the right answer, it's redundant with the identity subsystem, not
  broken by it; (3) nothing in the core principle requires it — "AI
  consumes the resolved context" is fully satisfied by Groups (a)-(c)
  above. Revisit only if a real correctness gap surfaces (e.g. a
  Position Account session whose `departmentIds` genuinely disagrees
  with what a downstream service's own re-derivation produces for that
  same actor — not expected, but the reason this is deferred, not
  ruled out, forever).
- **New institutional entity types** (Library, Hostel, Exam Cell,
  Placement Office) — the scoping doc's own illustration of why the
  identity-context-centric principle matters, not something this phase
  builds. Phase 3 makes AI ready to absorb a future entity type without
  its own code changing; it does not add one.
- **A frontend UI for logging into a Position Account** — doesn't exist
  yet (confirmed above), not built here. This phase is backend-only,
  verified the same API-level way Phase 2's own was.
- **Level 2's scope-configuration policy itself** — unchanged by this
  phase, per ADR-021; whether/how a Level 2 position's AI tool access
  should differ from Principal's remains real future product policy,
  not decided here (see step 3's own guidance: default to NOT granting
  `'level2'` speculatively).

## Verification

`node --test "tests/**/*.test.js"` after every step, same as every
prior phase. The concrete end-to-end proof for the DoD's core claim:
step 8's dual-login test (one person, two contexts, provably different
`effectiveRole`/tool availability/prompt context) — the same style of
test that proved Phase 2's own "never unioned" claim, applied one layer
up at AI's consumption boundary instead of at `resolveCapabilitiesForPosition`
itself.
