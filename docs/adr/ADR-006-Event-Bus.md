# ADR-006: Event Bus deferred

Status: Deferred (see Decisions-To-Revisit.md)

## Decision
Do not introduce an event bus (Redis pub/sub, RabbitMQ, etc.) in v1.
Services call each other directly through the Business Services
layer.

## Reasoning
The current architecture is a modular monolith (ADR-003). Direct
service calls are sufficient at this scale. An event bus adds real
infrastructure (a new deployable dependency, a new failure mode) to
solve a decoupling problem this system doesn't have yet — building it
now risks the same "half-built, over-scoped" pattern flagged
elsewhere in this project (e.g. the original LangGraph suggestion,
which was similarly deferred in favor of native tool-calling).

## Revisit when
- Multiple independently deployable services actually exist, or
- Long-running asynchronous cross-service workflows become common, or
- Direct service-to-service calls become a demonstrated coupling
  problem, not a theoretical one.

See Decisions-To-Revisit.md for tracking.

## Review — 2026-07-03 (post Module 0)

No change. Module 0 built the first genuine cross-boundary workflow
this system has: principal invitation, where the Platform API creates
a record and the Tenant API consumes it later, from a different
process context (no shared request, no shared auth). This is exactly
the shape of thing an event bus would be pitched for — and it was
built instead with a shared, unprivileged-on-one-side database table
(`principal_invitations`) acting as an inbox, no pub/sub needed. That
worked cleanly and is fully tested. If anything this is affirmative
evidence for staying deferred, not a reason to reconsider: a real
cross-boundary workflow arrived and a table was sufficient. Still
watching for the real trigger — NotificationService, whenever it's
built, is the first plausible candidate for something event-shaped
("invitation accepted" -> send welcome email), but that's speculative
until NotificationService actually exists.
