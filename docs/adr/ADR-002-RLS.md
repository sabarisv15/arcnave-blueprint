# ADR-002: PostgreSQL Row-Level Security for tenant isolation

Status: Accepted

## Decision
Every tenant-scoped table is protected by PostgreSQL Row-Level
Security. Tenant Middleware sets `SET LOCAL app.current_tenant =
'<college_id>'` at the start of every request's transaction. RLS
policies filter every query by that setting automatically.

## Alternatives considered
- **Application-level filtering only** (`WHERE college_id = tenant_id`
  in every query): rejected as the sole mechanism. It's a convention,
  not a guarantee — one missed clause in one query, anywhere in the
  codebase, leaks one college's data to another. This is the single
  most common real-world multi-tenant SaaS bug.
- **Bare connection-level `SET`** instead of `SET LOCAL`: rejected.
  With a pooled connection (FastAPI/SQLAlchemy), a connection that
  sets tenant context and returns to the pool without resetting can
  leak that context into the next request that reuses it. `SET
  LOCAL` is scoped to the transaction and resets automatically when
  it ends.

## Reasoning
RLS makes the wrong query physically incapable of returning another
tenant's rows, even if a developer writes `SELECT * FROM students`
with no filter at all. Defense in depth: Tenant Middleware is the
first line, RLS is the backstop.

## Consequences
- Requires disciplined transaction handling: `SET LOCAL` must happen
  inside the same transaction as the query, every time.
- Mandatory release-gate test: run two tenants' requests on the same
  pooled connection and assert tenant B can never see tenant A's
  rows. This must pass before any module touching tenant data ships.
- RLS policies alone are not the whole mechanism — table owners and
  superusers can bypass them. See ADR-015 for the separate decision
  on why the app's runtime DB role must differ from the role that
  owns the tables (i.e. the one that runs migrations).
