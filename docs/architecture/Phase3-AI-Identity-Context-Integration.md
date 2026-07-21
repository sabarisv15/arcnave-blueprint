# Phase 3 (post-Phase-2): AI Identity Context Integration

**Status: scoped, not planned in detail, not implemented. Depends on
Phase 2 shipping first.**

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

## Why this is a separate phase, not part of Phase 2

Phase 2's responsibility is to expose a stable, two-function identity
context API:

- `resolveCapabilities(userId)` → Personal Identity Context (already
  shipped, Phase 1)
- `resolveCapabilitiesForPosition(positionAccountId)` → Institutional
  Identity Context (Phase 2's deliverable)

Once both exist and are stable, refactoring the AI Policy Gate to
consume the active identity context instead of `req.jwtClaims.role` is
its own body of work — it touches AI authorization, tool routing,
prompt context construction, and tool-scoping (the `allowedRoles` table
in `AI-Governance.md` §8, currently keyed on raw role strings
principal/hod/staff), not the identity subsystem itself. Bundling it
into Phase 2 would conflate "build the API" with "migrate a consumer
of the API," the same kind of scope-mixing Phase 2's own delivery
ordering elsewhere deliberately avoids.

## What this phase will need to touch, when planned in detail

Not planned yet — recorded here so it isn't lost, not as a commitment
to this exact list:

- `routes/ai.js` — replace `actor.role = req.jwtClaims.role` with
  `actor.role = req.capabilities.effectiveRole` (whatever `middleware/
  identity.js` has already resolved and attached to the request by the
  time this route runs). `routes/ai.js` itself performs no branching on
  which resolver produced `req.capabilities` — that decision is already
  made and finished upstream.
- `services/aiToolRegistry.js`'s Policy Gate (`allowedRoles.includes`,
  `aiClassificationAccess.permittedClassifications`) — same swap, same
  "just read what's already resolved" rule. Neither function should
  gain a "which kind of account is this" check of its own.
- `AI-Governance.md` §8's tool registry table — `allowedRoles` should
  express itself generically in terms of whatever effective-role labels
  the identity subsystem can produce, not a hardcoded enumeration of
  human-vs-institutional cases. If the identity subsystem later adds
  Library/Hostel/Exam-Cell/Placement-Office identity contexts, this
  table gains new label values, not new AI-side logic.
- Prompt context construction (what the AI is told about "who is
  asking") — should describe whatever the resolved context says about
  itself (a title/scope string the identity subsystem can supply),
  not a prompt-builder `if (institutional) ... else ...` branch.
- Tool-scoping — a tool's visible data/action set should narrow to
  whatever scope is already present on `req.capabilities` (departments,
  classes, etc.), the same generic way ordinary-route visibility
  already narrows — not a special case for "is this an institutional
  account's assistant."

## Sequencing

Do not start this until Phase 2 has shipped `resolveCapabilitiesForPosition`
and it is proven stable (per Phase 2's own Definition of Done). This
document is a placeholder recording scope and intent, not a
step-by-step plan — write that plan when this phase is actually
picked up.
