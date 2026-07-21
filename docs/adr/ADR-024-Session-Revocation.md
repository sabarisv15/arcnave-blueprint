# ADR-024: Session revocation — direct DB check, no cache layer yet

Status: Accepted

## Decision
Add a `token_version` column to `users` and, once
[[ADR-021-Institutional-Position-Account-Model]]'s login path exists,
to `position_accounts`. Every authenticated request re-checks the
JWT's embedded `token_version` against the current DB value on that
row — a direct DB read, not a cached lookup, and unconditional (not
gated behind a rollout flag). Refresh tokens are stored in a new
append-only table (`refresh_token_id`, owning `user_id` or
`position_account_id`, `revoked_at`), revocable individually or
in bulk per account.

`token_version` is incremented, and all of that account's refresh
tokens revoked, whenever: a password is reset, MFA is reset, or (once
[[ADR-021-Institutional-Position-Account-Model]]'s reassignment
lifecycle exists) a position account's occupant changes.

## Alternatives considered
- **Redis/in-memory cache for `token_version` from day one**:
  rejected for now. This codebase already has a direct precedent for
  not introducing new infrastructure ahead of a proven need —
  `ADR-011-Redis-Task-Queue` explicitly deferred Redis for background
  jobs until `BackgroundTasks`-equivalent in-process work was proven
  insufficient, precisely to avoid "guessed-ahead-of-need" decisions.
  The same reasoning applies here: no Redis instance exists in this
  stack today, and adding one solely to cache a single integer column
  is exactly the kind of premature infrastructure this project has
  chosen to avoid elsewhere.
- **Skip revocation, rely on short-lived access tokens only**:
  rejected — doesn't satisfy the "immediate cutover" requirement
  agreed during the identity model review; a short-lived token still
  leaves a window where a departed occupant retains access.

## Reasoning
A direct DB read on every request is the simplest correct
implementation and matches this project's established default (add
infrastructure when a measured need proves it, not speculatively). It
does add one DB round-trip to every authenticated request where there
was none before — that cost must be measured, not assumed, before this
is trusted at real production scale.

## Revisit when
A load test shows a material latency regression from the added
per-request DB read. At that point, introduce a cache (in-memory
per-instance with a short TTL, or Redis if multi-instance consistency
requires it) — this would be the first real, evidence-backed trigger
for introducing Redis into this stack, tracked as
`ADR-026-Identity-Cache-Strategy`.

## Consequences
- New column: `users.token_version` (default 0, incremented on
  reset/reassignment).
- New table: `refresh_tokens` (or equivalent), revocable per account.
- `position_accounts.token_version` to be added once
  [[ADR-021-Institutional-Position-Account-Model]]'s login path is
  built.
- No new infrastructure dependency introduced by this decision.
