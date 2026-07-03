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

## Review — 2026-07-03 (post Module 0)

No change to priority — still no load that justifies it. But this is
the row where Module 0 actually produced relevant evidence, worth
recording rather than a blank "no change."

This ADR named the RLS `SET LOCAL`/pooling pattern specifically as
something that "would need re-verification under a load balancer."
Module 0's release-gating test
(`test_rls_tenant_isolation.py::test_tenant_isolation_on_pooled_connection`)
already verified the exact mechanism that re-verification would be
about: `set_config(..., is_local=true)` is scoped per-transaction, not
per-connection or per-process, and resets automatically at transaction
end regardless of commit or rollback — proven, not assumed, on a
`pool_size=1` engine forced to reuse one physical connection across
"requests." That property doesn't depend on there being only one
application instance; a second FastAPI instance is just a second,
independent connection pool obeying the same per-transaction
semantics, not a new class of leak vector. This meaningfully lowers
the risk of the biggest unknown this ADR flagged, for whenever the
real trigger (sustained load) fires.

This doesn't fully clear horizontal scaling — `app/core/request_context.py`'s
contextvars are process-local, which is fine (they're per-request
state, not shared across requests, so a second process just means a
second independent copy), but session affinity, `SessionLocal`/
`PlatformSessionLocal` pool sizing per instance, and log aggregation
across instances are all real questions nobody has looked at yet.
Priority stays Low; noting the RLS piece is de-risked, not the whole
decision.
