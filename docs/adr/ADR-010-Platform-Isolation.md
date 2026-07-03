# ADR-010: Platform layer is a separate application from the tenant app

Status: Accepted

## Decision
Super Admin / tenant provisioning is a completely separate
application (`admin.arcnave.com`, its own Platform API, its own
auth) from the tenant-facing product (`<college>.arcnave.com`). They
never share an authentication flow.

## Alternatives considered
- **Super Admin as a role inside the normal RBAC model**: rejected.
  Creating a college is by definition a cross-tenant operation — it
  requires seeing across every `college_id`. Making Super Admin "just
  another role" inside the tenant-scoped RLS path means either
  weakening RLS with a bypass baked into every query, or accepting
  that one role quietly breaks the tenant isolation model everywhere
  else depends on.

## Reasoning
Keeping Platform Admin structurally outside the RLS-scoped path means
RLS stays airtight for every tenant-facing request, with no special
case to remember or accidentally weaken later.

## Consequences
- Platform Admin provisions tenants but never logs into the tenant
  application itself.
- Platform infrastructure (wildcard DNS, wildcard TLS, tenant
  resolver) is tracked as its own concern under the Platform layer,
  not folded into tenant-side auth work.
