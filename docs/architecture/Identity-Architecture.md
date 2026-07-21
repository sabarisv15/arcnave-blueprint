# ARCNAVE — Identity Architecture

Status: Schema and resolution layer designed and built (see ADR-021,
ADR-022, ADR-024). Not yet wired into any live enforcement path — the
Current Model and Target Model columns throughout this document say
exactly where that line sits today.
Last updated: 2026-07-21

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
- **Base Level 4 (staff)** — person-centric, not part of this account
  model at all: no Position, no Position Account. Scope for this level
  comes from role/assignment data outside this model entirely (e.g.
  class-tutor or faculty-allocation assignments), not from anything
  described here.

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

### Current Model
No per-request resolution happens. The role label embedded in the
session token at login time (§8) *is* the effective identity for the
lifetime of that session — none of the steps above (Occupant →
Position → Scope → Capabilities) run on any request today.

### Target Model
Each step in the diagram above is a real, independently verified
operation (§7 details each one): given an authenticated subject, resolve
their active Occupant link(s), the Position(s) those link to, the scope
those positions imply, and the capabilities that scope grants —
producing an Effective Identity that authorization (§9) and workflow
routing consult in place of a static token claim. The resolver that
performs this pipeline already exists and is independently verified
against real seeded data; it has zero live callers today — no request
path invokes it yet.

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

### Current Model
Every authorization and workflow-routing check reads the role label
embedded in the session token at login time — a claim minted from the
User's own record. This is the live, active mechanism for every level
today, including structural ones. It is not legacy scaffolding kept
alive pending a migration; it is how authentication actually happens
today, provisioned alongside (not superseded by) the structural
Position Account created at the same time.

### Target Model
The Position Account already carries everything an authentication path
needs (credential, MFA state, session-version counter, recovery
methods), but nothing reads or writes it for authentication purposes
yet. Building that path is the prerequisite for retiring any part of
the User-record-based flow — not a parallel option that can simply be
switched on.

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

### RBAC
Authorization is a static, code-level role-to-permission table keyed
on the same legacy role label space authentication issues today — not
tenant-configurable, and not aware of positions, accounts, or
occupants at all. This is a named, tracked gap, not an oversight.

### Position-based permissions
Not enforced anywhere yet. The Capability Resolver's effective-role
output is deliberately shaped to be a drop-in comparison against the
same role labels the permission table already uses, specifically so a
future cutover can replace the *source* of the role label (resolved
position data instead of the User record) without reshaping every call
site that checks it.

### Workflow integration
Approval routing runs entirely off the same User-record role label
today; it does not consult the Capability Resolver or any position
data. Wiring workflow routing to resolved capabilities is a named
future direction, not something already in place.

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
- **Reassignment** *(Target Model — specified by ADR-021, not yet
  implemented by any component)* — a single, atomic, all-or-nothing
  operation:
  1. Revoke all active sessions for the account.
  2. Invalidate every outstanding refresh credential.
  3. Increment the session-version counter.
  4. Reset the password credential to a temporary one.
  5. Clear MFA enrollment and recovery methods.
  6. Close the old occupant link, open the new one.
  7. Require password change and MFA re-enrollment on the new
     occupant's first login.

  Unchanged by this sequence: the official mailbox, resolved
  permissions, and audit history — reassignment resets who can log in,
  never what the position is or has done.
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
Session tokens carry the tenant, the person, their role label, a
session-version number, and a token type — minted at login or refresh.
Nothing in the token today references Position Accounts or occupancy.

### Session-version counter
Exists on both the User record (live) and the Position Account
(schema-ready, unused — no authentication path writes or reads it
yet). Incremented on password reset, MFA reset, or (once reassignment
is implemented) an occupant change; every increment invalidates every
previously issued token for that identity.

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
  still routes through the same approval mechanism, keyed on the
  Current Model's role labels. Nothing about this identity model has
  changed how AI actions are gated — the gate itself is unchanged; only
  the source of truth for *who's asking* has not yet moved from the
  Current Model to the Target Model described above.

## 14. Current vs Target Architecture
This table is the authoritative summary of implementation status. The
Current Model / Target Model notes in the sections above elaborate on
individual rows here; if implementation status changes, this table and
the corresponding section notes must be updated together.

| Area | Current Model | Target Model |
|---|---|---|
| Data model | Position/Account/Occupant/Module-scope/Department-scope tables exist, tenant-isolated, additive only | Same data model, fully consumed |
| Structural Level 1 provisioning | Automatic, unconditional, at institution onboarding | Unchanged |
| Resolution layer | Capability Resolver built, independently verified, zero live callers | Called from authorization, AI tooling, and workflow routing |
| Authentication | Entirely User-record based, session token carries a role label | Position Account authentication for structural levels; User-record based (or a decided alternative) for the base level |
| Session revocation | Enforced unconditionally, but only against the User record today; the Position Account's session-version counter exists unused | Position Account session-version counter checked once its authentication path exists |
| Authorization | Static role→permission table keyed on legacy role labels | Position-derived effective role feeding the same table, or its successor |
| Workflow routing | Keyed on the User record's role label | Consumes resolved capabilities, per the resolution layer's stated intent |
| Reassignment lifecycle | Specified, not implemented by any component | A real, atomic reassignment operation exists and is callable |
| Audit identity | Only the Actor is recorded | Acting Position Account and Position recorded alongside the Actor |
| Migration/backfill tooling | Removed — no live institution predates this schema | N/A unless a real live migration need arises |

## 15. Related Documents
- `docs/adr/ADR-021-Institutional-Position-Account-Model.md` — the
  data model and occupant-reassignment lifecycle decision.
- `docs/adr/ADR-022-Identity-Resolver-Contract.md` — the Capability
  Resolver's frozen public contract.
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
| Position / Position Account / Occupant / scope tables | `positions`, `position_accounts`, `position_occupants`, `position_module_assignments`, `position_department_assignments` |
| Capability Resolver façade | `services/identityService.js` (`resolveCapabilities`) |
| Individual resolvers | `services/identity/positionResolver.js`, `moduleResolver.js`, `departmentResolver.js`, `assignmentResolver.js`, `visibilityResolver.js` |
| Authentication Service | `services/authService.js` |
| Session revocation check | `middleware/sessionRevocation.js` |
| Role→permission table | `middleware/permissions.js` |
| Workflow routing | `services/workflowChainService.js` |
