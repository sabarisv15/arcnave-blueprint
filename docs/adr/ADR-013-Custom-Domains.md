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
