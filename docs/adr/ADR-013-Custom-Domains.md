# ADR-013: Subdomain-per-tenant, custom domains deferred

Status: Deferred (see Decisions-To-Revisit.md)

## Decision
Each college gets a subdomain (`<college>.arcnave.com`), provisioned
via wildcard DNS and wildcard TLS. Branded custom domains
(`portal.somecollege.edu`) are not built in v1.

## Reasoning
Subdomains are simple to provision automatically as part of tenant
onboarding (Module 0) and require no per-customer DNS coordination.
Custom domains are a real feature but add real complexity (per-tenant
DNS verification, per-tenant TLS certificate issuance) that isn't
justified until a customer actually asks for it.

## Revisit when
A first enterprise customer specifically requests a branded domain.

## Review — 2026-07-03 (post Module 0)

No change to priority or timeline — still waiting on a real customer
ask, and none has come. But Module 0 did build the actual tenant
onboarding this ADR assumed ("subdomains are simple to provision
automatically as part of tenant onboarding"), so that assumption is no
longer speculative: `POST /api/v1/platform/colleges` takes `subdomain`
as a required field, enforced unique at the DB level, and
`TenantMiddleware.resolve_tenant`'s subdomain path just works off of
it with no DNS/TLS coordination of any kind. The reasoning held up.

One concrete technical note worth recording for whenever this is
actually revisited: `_extract_subdomain` in
`app/middleware/tenant.py` resolves a tenant by taking the first label
off the `Host` header — it has no notion of an arbitrary domain
mapped to a `college_id`. A real custom-domain implementation
wouldn't extend that function; it would need a genuinely new
resolution source (a `custom_domain` -> `college_id` lookup, probably
a new column on `colleges`) added to `resolve_tenant`'s candidate list
alongside subdomain/JWT-claim/explicit-code, with the same
conflict-is-a-reject discipline the other three sources already have.
Not a reason to build it now — just so the next person doesn't try to
bend subdomain-parsing logic into doing double duty.
