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
