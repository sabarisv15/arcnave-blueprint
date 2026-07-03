# ADR-014: Single FastAPI instance, horizontal scaling deferred

Status: Deferred (see Decisions-To-Revisit.md)

## Decision
Run a single FastAPI application instance in v1. Do not build for
multiple concurrent instances yet.

## Reasoning
No current load justifies it, and it adds real complexity — session/
state handling, and especially care around the RLS `SET LOCAL` +
connection pooling pattern (ADR-002), which already needs to be
correct per-transaction even on a single instance and would need
re-verification under a load balancer.

## Revisit when
Sustained load requires more than one application instance to serve
requests reliably.
