# ARCNAVE — Identity Architecture

Status: Both identity contexts shipped (see ADR-021, ADR-022, ADR-023,
ADR-024). Personal Identity Context has been live since Phase 1;
Institutional Identity Context (Position Account login,
`resolveCapabilitiesForPosition`, the reassignment lifecycle, and the
Class Tutor Level 4 `position_type` carve-out) shipped in Phase 2. The
Current Model and Target Model columns throughout this document are
kept as a historical record of what changed and when, not because a
gap still exists — §14 states current status precisely.
Last updated: 2026-07-22 (Phase 2 complete)

## 1. Purpose
This document is the identity and authorization blueprint for ARCNAVE.
It exists because the identity model spans a data model, a read-only
resolution contract, and a session-revocation mechanism that no single
decision record narrates end to end — this file is that narrative,
told as architecture (concepts, flows, responsibilities), not as a
tour of code. `Architecture.md` carries a short summary of this model
at the system-shape level; `BusinessRules.md` carries the
business-rule-level statement of its lifecycle rules; this document is
the detailed version both point back to. An informative mapping from
the concepts described here to their current implementation is
provided in the Appendix for engineers who need to locate the code —
it is not required to understand the architecture itself.

## 2. Architectural Principles
These principles govern every decision in the sections that follow;
where a design choice looks unusual, it is usually a direct consequence
of one of these.

1. **Identity is organizational, not personal.** The organization's
   structure (its positions) is the primary identity surface. People
   move through that structure; they are not the structure.
2. **Accounts are permanent; occupancy is temporary.** A position's
   credentials, sessions, and audit trail belong to the position, not
   to whoever currently holds it — reassignment changes who can log
   in, never what the position is or has done.
3. **One contract resolves capability, and nothing bypasses it.**
   Every consumer that needs to know "what can this person currently
   do" resolves it through a single, frozen contract — never by
   re-deriving the answer independently at each call site.
4. **Authorization decisions trust resolved state, not embedded
   claims, for anything that can change mid-session.** A token asserts
   who logged in; it does not get to keep asserting that a session is
   still valid — that is re-checked against current state on every
   request.
5. **Audit identity is compound, never collapsed.** Who acted (the
   person) and in what capacity they acted (the position) are recorded
   as two distinct facts, not merged into one string, so either can be
   queried independently.
6. **Nothing is ever silently deleted.** Positions, accounts, and their
   history persist indefinitely; lifecycle state is expressed by
   presence/absence of an active link, never by removing a row.
7. **Build ahead of need only as far as a frozen contract allows.**
   The resolution layer was built and verified before anything
   consumes it, specifically so later consumers can build directly
   against a stable interface — but nothing is wired into enforcement
   speculatively ahead of an actual consumer.

## 3. Identity Philosophy
- **Organization-first model** — the institution's org chart (Position)
  is the primary entity; people are secondary, moving through it over
  time. This inverts a person-first design, where the individual's own
  record *is* the identity.
- **Positions outlive people** — a Principal position exists whether or
  not anyone currently holds it. Reassigning it doesn't create a new
  identity; it changes who a permanent identity's current occupant is.
- **Permissions belong to positions** — for structural positions,
  credentials, sessions, and resolved capabilities (module/department
  scope) attach to the position's account, not to whichever person
  currently occupies it.
- **Users occupy positions** — a person is linked to a position through
  a time-boxed occupancy record, never directly. A person may hold
  zero, one, or more than one position at a time; holding no structural
  position at all is the ordinary case for most people, not an error
  state.

## 4. Core Concepts
- **User** — the person: identity attributes independent of any
  position (name, contact information, employment record). Under the
  Current Model (§8), the User record is also still where
  authentication actually happens for every role.
- **Position** — the organizational seat itself: which institution it
  belongs to, its structural level, and its title. Structural levels
  are platform-defined; configurable levels are created and titled by
  a higher structural level per institution; the base staff level is
  person-centric and explicitly outside this account model entirely.
- **Position Account** — the permanent, position-centric identity:
  official institutional mailbox, password credential, MFA
  enrollment state, recovery methods, and a session-version counter
  used for revocation. Exactly one account per position, created once,
  never removed. Reassignment resets this identity's credentials and
  session state in place — it never creates a second account for the
  same position.
- **Occupant** — an append-only link between a Position Account and
  the person currently holding it, with a start time and an optional
  end time. At most one occupant link is active per account at a time,
  while the full occupant history accumulates indefinitely. An
  occupant link carries no credentials, MFA, or session state of its
  own — all of that lives on the account.
- **Capability** — a resolved fact about what a person is currently
  entitled to, derived from their active position(s) rather than
  stored directly: the positions they hold, the modules and
  departments those positions own, and the visibility scope those
  imply. A Capability is always computed at read time from current
  occupancy and assignment state — it is never itself a stored value.
- **Effective Role** — a single label derived from a person's resolved
  capabilities, chosen specifically to be directly comparable to the
  role labels described in §8/§9 (e.g. a structural Level 1 position
  resolves to the same label a Principal-equivalent User record
  carries today). It exists so that authorization and workflow logic
  can compare "what this person can do" against one label regardless
  of whether that label came from a User record or from resolved
  position data.

## 5. Organizational Identity Model

### 5.1 Logical model
```
        ┌───────────┐        ┌────────────────────┐        ┌───────────────┐
        │  Position  │──────▶│  Position Account   │◀──────▶│   Occupant     │
        │ (the seat) │  1:1  │ (permanent identity) │ 1: ≤1  │ (time-boxed    │
        └───────────┘        └────────────────────┘  active │  person link)  │
              │                                              └───────┬────────┘
              │ scoped to                                            │
              ▼                                                      ▼
   ┌─────────────────────┐                                    ┌────────────┐
   │ Modules / Departments │                                   │    User     │
   │ (what the position    │                                   │ (the person)│
   │  is responsible for)  │                                   └────────────┘
   └─────────────────────┘
```
A Position has exactly one Position Account. A Position Account has at
most one *active* Occupant at any moment, but an unbounded history of
past ones. An Occupant always resolves to exactly one User. Module and
department scope attach to the Position itself, independent of who
currently occupies it.

### 5.2 Position hierarchy
- **Structural Level 1 (Principal-equivalent)** — platform-defined,
  one active occupant per institution. Provisioned automatically and
  unconditionally as part of institution onboarding — not an optional
  or gated step.
- **Structural Level 2 (institution-configured)** — created and titled
  by Level 1 per institution. No fixed scope-mapping in the resolution
  model yet — deliberately left as future policy work, not assumed
  here.
- **Structural Level 3 (HOD-equivalent)** — platform-defined, scoped to
  whichever departments it currently owns (§5.3).
- **Base Level 4 (staff)** — person-centric by default: plain staff
  (no assignment) get no Position, no Position Account. **Narrow
  carve-out (Phase 2)**: a Level 4 position row now CAN exist when it
  carries a real `position_type` assignment — today, `'class_tutor'`.
  Such a position follows the exact same Position/Account/Occupant
  model as HOD, one level down: HOD-only assignment, scoped to the
  HOD's own department. This is not a new level — `positions.level`'s
  `1-4` range is unchanged; `position_type` is orthogonal to level, and
  the schema stays open for future assignment types (Placement
  Coordinator, NSS Coordinator, Library In-charge, Exam Cell) without
  inventing a new level per assignment. Scope for a plain Level 4
  staff member (no assignment) still comes from role/assignment data
  outside this model entirely (e.g. faculty-allocation), not from
  anything described here.

### 5.3 Department ownership
A configurable-level or structural-level position may own one or more
departments; a department has at most one owning position active at a
time. Ownership is append-only — closing one ownership link and
opening another preserves the full ownership history rather than
overwriting it. Module ownership (which platform capability areas a
position is responsible for) follows the identical shape, scoped to
the institution and the module rather than to a department.

### 5.4 Database notes
`ERD.md` is the canonical relational schema for ARCNAVE, including the
tables backing this model — this section states the architectural
guarantees that schema provides, not a restatement of it. The logical
model above is backed by that relational schema, with the following
properties, kept separate here from the conceptual model so the two
don't get read as one thing:
- Every table in this model carries its own tenant identifier directly
  (rather than requiring a join to derive it), so tenant-isolation
  policy enforcement is a single-column check on every table, with no
  exception.
- Row-level tenant isolation is enforced at the database layer, not
  only in application code.
- No row in this model is ever deleted through normal application
  access — positions and accounts are "created once," occupancy and
  scope assignments are append-only ledgers. Lifecycle state is always
  expressed by the presence or absence of an *active* link, never by
  removing history.
- Uniqueness constraints enforce, at the database level, the
  cardinalities described in §5.1: one account per position, at most
  one active occupant per account, at most one active owning position
  per department.

## 6. Identity Resolution
This section describes a distinct concern from §8: how an *already
authenticated* request resolves into a full effective identity on
every request, not how a subject authenticates in the first place
(§8 covers that, once per session).

```
  Authenticated Subject
        │
        ▼
  Resolve Occupant
        │
        ▼
  Resolve Position
        │
        ▼
  Resolve Scope
        │
        ▼
  Resolve Capabilities
        │
        ▼
  Effective Identity
```

### Personal Identity Context (shipped)
Represents the authenticated individual. On every request, the
pipeline above runs for real: `identityService.resolveCapabilities`
resolves the subject's active Occupant link(s), the Position(s) those
link to, and the capabilities those positions grant — unioned across
every position the person currently holds, plus a derived effective
role label and scope. This is the live mechanism behind authorization
(§9), workflow routing, visibility/data-scope, and audit logging today
(Phase 1, commits `35092a2`..`231a5cc`). This context is for the user's
own workspace and personal operations — it is deliberately allowed to
reflect everything a person is entitled to, not scoped to a single
office.

### Institutional Identity Context (shipped, Phase 2)
Represents a single institutional account (Position Account) rather
than a person. Capabilities resolve *exclusively* for that one account
— never merged with any other responsibilities the current occupant
happens to also hold — via a second, position-scoped resolver,
`identityService.resolveCapabilitiesForPosition` (ADR-023), that sits
alongside the frozen `resolveCapabilities` contract (ADR-022) rather
than replacing it. This context is for acting on behalf of a specific
institutional entity (logging in "as HOD-CSE," not "as Alice") — live
for Level 1/2/3 positions and the Class Tutor assignment (Level 4 +
`position_type='class_tutor'`). See
`docs/architecture/Phase2-Position-Account-Auth-Plan.md` for the
delivery record and [[ADR-023-Institutional-Capability-Resolver]] for
the frozen contract itself.

## 7. Capability Resolution

```
   Occupant link(s) for a given User
              │
              ▼
     ┌──────────────────┐
     │ Position Resolver │  → active Position(s) for this person
     └──────────────────┘
              │
   ┌──────────┼──────────────┐
   ▼          ▼               ▼
┌────────┐ ┌───────────┐ ┌──────────────────┐
│ Module │ │ Department│ │ Visibility Scope   │
│Resolver│ │ Resolver  │ │ Resolver           │
└────────┘ └───────────┘ └──────────────────┘
   │          │               │
   └──────────┴───────┬───────┘
                       ▼
           Capability Resolver (single façade)
                       │
                       ▼
        Resolved capabilities: positions held, effective
        role label, visibility scope, module/department reach
```

The resolution layer is one public, frozen contract (ADR-022) composed
from several independent, single-purpose resolvers — each resolver
reads one slice of the model (active positions, module ownership,
department ownership, current occupant, visibility scope) and never
calls another resolver directly; only the façade composes them. This
mirrors the same "one entry point, independently swappable internals"
principle used elsewhere in the platform's service layer.

- **Position resolution** — a person's active positions.
- **Module resolution** — which platform capability areas an active
  position currently owns.
- **Department resolution** — which departments an active position
  currently owns.
- **Occupant resolution** — the current occupant of a given Position
  Account, or none.
- **Visibility resolution** — the scope a position implies (roughly:
  structural Level 1 sees the whole institution, structural Level 3
  sees its owned departments, no structural position sees only what
  the person is individually assigned to).

**Effective capabilities**: resolution never treats "no active
position" as an error — that is the ordinary base-level case. It
returns every active position a person holds (holding more than one is
not excluded by the model), plus a derived effective role label and
scope, so a caller comparing against a single role string always has
something directly comparable, with a documented tie-break when more
than one position is held.

## 8. Authentication

```
  ── Current Model ──────────────────────
  User record ──(password, MFA)──▶ Session

  ── Target Model ───────────────────────
  Occupant ──▶ Position Account ──(password, MFA)──▶ Session
```

### Personal Identity Context (shipped)
Login is via the User record (username/password, MFA), minting a
session whose claims are then resolved into a full Personal Identity
Context on every request (§6/§7) via `resolveCapabilities`. This is the
live, active mechanism for every level today, including structural
ones. It is not legacy scaffolding kept alive pending a migration; it
is how authentication actually happens today, provisioned alongside
(not superseded by) the structural Position Account created at the
same time.

### Institutional Identity Context (shipped, Phase 2)
The Position Account carries everything an authentication path needs
(credential, MFA state, session-version counter, recovery methods) and
now has its own login path: `POST /position-accounts/login`/`/refresh`/
`/logout`, invite-based credential bootstrap (`POST /positions/
:positionId/invitations`, `POST /position-accounts/invitations/accept`)
recursive by scope (Platform Admin → Level 1/2, Level 2 → HOD, HOD →
Class Tutor within their own department), mirroring the personal-login
route shapes. Logging into a Position Account directly, rather than
through a person's User record, produces an Institutional Identity
Context (§6) instead of a Personal one — a genuinely additional
capability, not a replacement for the User-record-based flow; the two
coexist by design — a person may have both a personal login and,
separately, credentials for an office they occupy (two logins per
person, deliberately).

## 9. Authorization

```
  ── Current Model ──────────────────────────────────────
  Session role label ──▶ static Role→Permission table ──▶ Allow/Deny

  ── Target Model ────────────────────────────────────────
  Session ──▶ Capability Resolver ──▶ effective role/scope
                                          │
                                          ▼
                           Role→Permission table (or its
                           position-aware successor) ──▶ Allow/Deny
```

### RBAC (shipped)
`middleware/rbac.js`'s `requirePermission` reads `req.capabilities.
effectiveRole`, populated per-request by the Personal Identity Context
resolver (`identityService.resolveCapabilities`, wired in by
`middleware/identity.js`) — not a static claim trusted from the token
at login time. The permission table itself is still a static,
code-level role-to-permission map, not yet tenant-configurable, but its
*input* (the role label) now comes from live position data every
request, not from the User record's stored role.

### Position-based permissions (shipped for both identity contexts)
Enforced for personal logins via the mechanism above; enforced for
Position Account (Institutional Identity Context) sessions via its own
position-scoped resolver, `resolveCapabilitiesForPosition` (ADR-023) —
see §6. `middleware/rbac.js`'s `requirePermission` needed no change to
support the second context: it already only reads `req.capabilities.
effectiveRole`, regardless of which resolver populated it.
`PERMISSION_ROLES` gained entries for the two new effective-role labels
Institutional sessions can produce (`'level2'`, `'class_tutor'`) that
Personal sessions never do. The Capability Resolver's effective-role
output is a drop-in comparison against the same role labels the
permission table already used, specifically so the source of the role
label could be swapped without reshaping every call site that checks
it — which is exactly what happened, twice now (Phase 1 for Personal,
Phase 2 for Institutional).

### Workflow integration (shipped)
Approval routing (`workflowChainService.resolveRoleUserId`) resolves
'principal'/'hod' via `identityService.resolvePositionOccupant`, the
reverse slot→occupant lookup — not a static User-record role label.

## 10. Position Lifecycle

- **Creation** — structural Level 1: automatic and unconditional, as
  part of institution onboarding. Configurable levels: created by
  Level 1 per institution. Structural Level 3: platform-defined per
  department. Base level: no Position is ever created — entirely
  outside this model.
- **Vacancy** — a Position can exist with no active occupant; its
  account and history persist regardless.
- **Occupancy** — established by opening a new occupant link; at most
  one is active per account at any time, enforced at the database
  level.
- **Reassignment** *(shipped, Phase 2 — implemented exactly as
  specified by ADR-021, with one documented amendment to step 4, see
  ADR-021's "Amendments")* — a single, atomic, all-or-nothing
  operation, `positionAccountInvitationService.reassignPositionOccupant`,
  uniform across Level 1/2/3 and the Class Tutor assignment, not
  per-type copies:
  1. Revoke all active sessions for the account.
  2. Invalidate every outstanding refresh credential.
  3. Increment the session-version counter.
  4. Reset credentials via a fresh invite (amended from "a temporary
     password" — reuses the same invite/accept mechanism first-time
     bootstrap already uses).
  5. Clear MFA enrollment and recovery methods.
  6. Close the old occupant link, open the new one.
  7. Require password change and MFA re-enrollment on the new
     occupant's first login (enforced by the ordinary invite-accept
     flow, since step 4 always routes through it now).

  Unchanged by this sequence: the official mailbox, resolved
  permissions, and audit history — reassignment resets who can log in,
  never what the position is or has done. Runs unconditionally
  whenever the occupant actually changes, including filling a
  previously vacant seat — not only when replacing someone. Idempotent:
  reassigning to the current occupant is a no-op, not a needless
  revoke/reset cycle.
- **Retirement** — no Position or Position Account row is ever removed.
  "Retiring" a position means it has no active occupant and none is
  expected — represented by the absence of an active occupant link,
  not a dedicated status field.

**Historical note**: an earlier phase of this model's rollout planned
a one-time backfill of pre-existing institutions into this schema,
under a dedicated rollback/backfill policy. That policy is now
superseded — no live institution predates this schema, so the backfill
tooling was removed entirely. It would only be revisited if a real
already-live institution ever needed migrating into this model after
the fact.

## 11. Session Management

```
  Every authenticated request
         │
         ▼
  Session-version check: does the token's embedded version
  still match the current value on record?
         │
    ┌────┴────┐
    ▼         ▼
  match     mismatch
    │         │
    ▼         ▼
 proceed   reject (session revoked)
```

### JWT
Two token shapes now exist, distinguished by `type`. Personal tokens
(`type: 'access'`) carry the tenant, the person, their role label, a
session-version number — minted at login or refresh via the User
record. Position Account tokens (`type: 'position_access'`) carry
`sub: positionAccountId` (never a `userId`, specifically so there is
nothing to accidentally union against), the tenant, `token_version`,
and no `role` claim at all — role is derived fresh every request from
live position state via `resolveCapabilitiesForPosition`, never trusted
from the token.

### Session-version counter
Exists on both the User record and the Position Account, both live.
`users.token_version` backs Personal sessions (Phase 1);
`position_accounts.token_version` backs Institutional sessions (Phase
2) via its own lookup path (`middleware/sessionRevocation.js`'s
`'position_access'` branch), not a reuse of the User-record check.
Incremented on password reset, MFA reset, or an occupant change; every
increment invalidates every previously issued token for that identity.

### Session revocation (ADR-024)
A revocation check runs unconditionally on every authenticated
request — not behind a rollout flag — after the token has been decoded
and tenant context established. It reads the current session-version
value for the token's subject and rejects the request if it no longer
matches the token's embedded value. It does not reject a
missing/invalid/expired token itself — that is a separate,
earlier-stage check; this one only adds a rejection reason for a
token that is structurally valid but names a now-stale session
version.

## 12. Audit Identity

### What is recorded
The model specifies four distinct fields per audit event, not one
"acted as" string: the **Actor** — the User performing the action —
the **Acting Position Account** (null for actions with no position
context), the **Position** (recorded independently of the Actor, for
querying history independent of who occupied it when), and the
**Timestamp/Action/Resource**. Today's audit logging captures only the
Actor — the Position Account and Position fields are part of the
model's contract for future call sites, not yet populated anywhere.

### Why Position Accounts preserve audit continuity
Because a Position Account survives reassignment unchanged, "Approved
by: Position — Principal · Acting Person — Dr. Arun Kumar" becomes
representable without collapsing to only one half of that fact — a
query against the Position returns its full approval history
regardless of how many people have occupied it, while a query against
the Actor still returns exactly what one specific person did. A design
where positions map directly to people has nothing for a credential,
session, or revocation to attach to that isn't the person's own
record, which makes this distinction structurally impossible, not
merely unbuilt.

## 13. AI Integration

- **Capability resolution** — the Capability Resolver is the intended
  single source an AI tool would eventually consult (through the same
  business-service layer every AI tool is required to go through) to
  know a user's active positions and scope. Not consulted by any AI
  tool today.
- **Permission boundaries** — AI tool authorization runs entirely off
  the same Current Model role-label path described in §9, not off
  position/account/occupant data. No AI tool reads Position Account
  data or resolves capabilities from this model today.
- **Workflow enforcement** — every AI action requiring human approval
  still routes through the same approval mechanism, keyed on the raw
  JWT role claim. Nothing about this identity model has changed how AI
  actions are gated — the gate itself is unchanged; only the source of
  truth for *who's asking* has not yet moved to either identity
  context described above.
- **Planned, separate phase**: migrating AI's Policy Gate onto the
  active identity context (Personal or Institutional) once both are
  stable is scoped as its own post-Phase-2 work item, not folded into
  Phase 2 itself — see
  `docs/architecture/Phase3-AI-Identity-Context-Integration.md`.

## 14. Current vs Target Architecture
This table is the authoritative summary of implementation status. The
Current Model / Target Model notes in the sections above elaborate on
individual rows here; if implementation status changes, this table and
the corresponding section notes must be updated together.

| Area | Phase 1 (Personal Identity Context) | Phase 2 (Institutional Identity Context) |
|---|---|---|
| Data model | Position/Account/Occupant/Module-scope/Department-scope tables exist, tenant-isolated, additive only | + `position_class_assignments`, `position_account_invitations`, `position_account_refresh_tokens`, `positions.position_type` — same data model, fully consumed |
| Structural Level 1 provisioning | Automatic, unconditional, at institution onboarding | Unchanged |
| Resolution layer | `resolveCapabilities` live — called from authorization, workflow routing, visibility, and audit (`35092a2`..`231a5cc`) | `resolveCapabilitiesForPosition` (ADR-023) live alongside it, scoped per-office, never merged with Personal |
| Authentication | User-record based, live for every level | Position Account login/refresh/logout live for Level 1/2/3 and Class Tutor, coexisting with (not replacing) the User-record path |
| Session revocation | Enforced unconditionally against the User record's `token_version` | Enforced unconditionally against `position_accounts.token_version`, its own lookup path |
| Authorization | Feeds the permission table's role input live (`req.capabilities.effectiveRole`); the table itself is still static/legacy-role-shaped | Institutional sessions feed the same table via `resolveCapabilitiesForPosition`'s effective-role output (`'level2'`/`'class_tutor'` are new labels this phase added) |
| Workflow routing | Resolves 'principal'/'hod' via `identityService.resolvePositionOccupant` | Extended to a `{classId}` overload resolving 'tutor' via the same mechanism |
| Reassignment lifecycle | Specified by ADR-021, not yet implemented | Implemented — one shared, atomic operation (`reassignPositionOccupant`) uniform across L1/L2/L3/Class-Tutor, with the invite-based credential-reset amendment documented in ADR-021 |
| Audit identity | Only the Actor is recorded | Still only the Actor recorded — Acting Position Account/Position fields remain part of the model's contract for a future call-site sweep, not yet populated by any Phase 2 call site |
| `classes.tutor_user_id` | Live, bare FK, global-UNIQUE | Removed entirely — Class Tutor is a full Position Account; `grep -rn tutor_user_id backend/src` returns nothing outside migration files |
| Migration/backfill tooling | Removed — no live institution predates this schema | Unchanged |

**Not yet built, either phase**: Position Account MFA enrollment UX
(columns exist, no enrollment flow to fork from — explicitly deferred,
ADR-021 decision 8 of the Phase 2 plan); a cache layer for either
resolver (ADR-026, deferred for both symmetrically); AI's Policy Gate
still reads the raw JWT role claim, not either identity context (§13,
scoped as Phase 3, see
`docs/architecture/Phase3-AI-Identity-Context-Integration.md`).

## 15. Related Documents
- `docs/adr/ADR-021-Institutional-Position-Account-Model.md` — the
  data model and occupant-reassignment lifecycle decision, amended in
  Phase 2 (Level 4 `position_type='class_tutor'` carve-out,
  invite-based credential reset).
- `docs/adr/ADR-022-Identity-Resolver-Contract.md` — the Capability
  Resolver's frozen public contract (`resolveCapabilities`, Personal
  Identity Context).
- `docs/adr/ADR-023-Institutional-Capability-Resolver.md` — the sibling
  contract for `resolveCapabilitiesForPosition`, Institutional Identity
  Context (Phase 2).
- `docs/architecture/Phase2-Position-Account-Auth-Plan.md` — the full
  Phase 2 delivery plan and record (23 steps, 6 groups).
- `docs/adr/ADR-024-Session-Revocation.md` — the session-revocation
  mechanism and its rationale for deferring a cache layer.
- `docs/adr/ADR-025-Migration-Rollback-Policy.md` — superseded backfill
  policy, kept for historical record only.
- `docs/adr/ADR-020-Role-Classification-Access.md` — the legacy
  role/permission model this document's Target Model eventually
  replaces.
- `docs/architecture/Architecture.md` — system-shape summary of this
  model within the platform's overall layering.
- `docs/architecture/ERD.md` — the canonical relational schema for the
  tables this document describes conceptually in §5.
- `docs/architecture/BusinessRules.md` (Staff section) — the
  business-rule-level statement of the Position Account lifecycle and
  session-revocation rules.
- `docs/architecture/AI-Governance.md` — the AI authority tiers
  referenced in §13.

## Appendix: Implementation Reference (informative)
Not part of the architecture itself — provided only so an engineer can
locate the current implementation. If this appendix and the sections
above ever disagree, the code and the ADRs are authoritative, and this
appendix is stale and should be corrected.

| Concept | Current implementation |
|---|---|
| Position / Position Account / Occupant / scope tables | `positions` (incl. `position_type`), `position_accounts`, `position_occupants`, `position_module_assignments`, `position_department_assignments`, `position_class_assignments` |
| Personal Capability Resolver façade | `services/identityService.js` (`resolveCapabilities`) |
| Institutional Capability Resolver façade | `services/identityService.js` (`resolveCapabilitiesForPosition`) |
| Individual resolvers | `services/identity/positionResolver.js`, `moduleResolver.js`, `departmentResolver.js`, `classResolver.js`, `assignmentResolver.js`, `visibilityResolver.js` |
| Personal authentication | `services/authService.js` |
| Institutional (Position Account) authentication | `services/positionAccountAuthService.js` |
| Institutional invite/accept/reassign | `services/positionAccountInvitationService.js` (`inviteToPosition`, `acceptInvitation`, `reassignPositionOccupant`) |
| Class Tutor assignment/reassignment | `services/classTutorService.js` (`assignClassTutor`, `reassignClassTutor`) |
| Session revocation check | `middleware/sessionRevocation.js` |
| Identity resolution middleware | `middleware/identity.js` |
| Role→permission table | `middleware/permissions.js` |
| Workflow routing | `services/workflowChainService.js` |
| Position Account routes | `routes/positionAccounts.js`, `routes/classes.js` (`POST`/`PUT /classes/:id/tutor`) |
