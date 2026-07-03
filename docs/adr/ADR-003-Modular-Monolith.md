# ADR-003: Modular monolith instead of microservices

Status: Accepted

## Decision
ARCNAVE is built as a single FastAPI application with clean internal
module boundaries (Business Services), not as separately deployed
microservices.

## Alternatives considered
- **Microservices per domain** (separate deployable Student service,
  Attendance service, etc.): rejected for v1. This is a solo-
  developer project; microservices add deployment complexity,
  network failure modes, and operational overhead that isn't
  justified without a team or a scaling problem that actually exists.

## Reasoning
Internal boundaries (Business Services, Repositories) give most of
the maintainability benefit of microservices — clear ownership,
testable units, no cross-domain reach-through — without the
operational cost of running and coordinating many services.

## Consequences
- The Event Bus (ADR-006) is deferred for the same reason: it solves
  a distributed-systems problem this architecture doesn't yet have.
- If ARCNAVE later needs true independent scaling or deployment of
  one domain (e.g. AI load separate from core CRUD), that's a
  deliberate future migration, not a default assumption.
