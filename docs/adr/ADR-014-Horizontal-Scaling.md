# ADR-014: Single Express (Node.js) instance, horizontal scaling deferred

Status: Deferred (see Decisions-To-Revisit.md)

## Decision
Run a single Express (Node.js) application instance in v1. Do not
build for multiple concurrent instances yet.

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
Module 0's release-gating test (`backend/tests/rls-tenant-isolation.test.js`,
`tenant isolation on a pooled connection` cases) already verified the
exact mechanism that re-verification would be about: `set_config(...,
true)` is scoped per-transaction, not per-connection or per-process,
and resets automatically at transaction end regardless of commit or
rollback — proven, not assumed, on a `node-postgres` `Pool`
constrained to `max: 1` (checked directly against the actual test
file before citing it here, not assumed to exist by analogy with
SQLAlchemy's `pool_size` — `node-postgres` genuinely has an equivalent
single-connection-forcing option) forced to reuse one physical
connection across "requests." That property doesn't depend on there
being only one application instance; a second Express (Node.js)
instance is just a second, independent connection pool obeying the
same per-transaction semantics, not a new class of leak vector. This
meaningfully lowers the risk of the biggest unknown this ADR flagged,
for whenever the real trigger (sustained load) fires.

This doesn't fully clear horizontal scaling — `backend/src/logging/context.js`'s
`AsyncLocalStorage`-backed request context is process-local, which is
fine (it's per-request state, not shared across requests, so a second
process just means a second independent copy), but session affinity,
`appPool`/`platformPool` pool sizing per instance, and log aggregation
across instances are all real questions nobody has looked at yet.
Priority stays Low; noting the RLS piece is de-risked, not the whole
decision.

(Originally written citing the Python/SQLAlchemy version of this same
proof; updated post-ADR-016 to cite the Node port once it re-verified
the identical property independently — the underlying evidence and
conclusion are unchanged, only the implementation the citation points
at.)
