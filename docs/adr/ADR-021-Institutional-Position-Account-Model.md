# ADR-021: Institutional Position Account Model

Status: Accepted

## Decision
The identity model is `Position → Institutional Position Account →
Current Occupant` — three distinct things, never `Position → User`.

- **Position** — the organizational seat (Level, title, college_id).
  Levels 1 and 3 are platform-defined structural positions; Level 2
  positions are created and configured by Level 1; Level 4 is
  person-centric (see [[Identity-Organization-Model]]), not part of
  this account model.
- **Institutional Position Account** — the permanent, position-centric
  identity. It owns, independent of whoever currently occupies it: the
  official institutional email/mailbox, `password_hash`, MFA secrets
  and enrollment state, recovery methods, `token_version`, refresh
  tokens, its resolved permissions (via module/department
  assignments), and its audit identity. One row per position, created
  once, never deleted.
- **Occupant** — an append-only, time-boxed link between an
  Institutional Position Account and the person (`users.id`) currently
  holding it. Occupancy carries no credentials, MFA, or session state
  of its own — all of that lives on the account and is reset whenever
  occupancy changes.

## Occupant reassignment lifecycle
Reassignment is a single transactional business operation — 100%
completed or 0% rolled back, never partial:

1. Revoke all active sessions for the account.
2. Invalidate every outstanding refresh token.
3. Increment `token_version`.
4. Reset credentials — issue a temporary password.
5. Clear MFA enrollment and recovery methods.
6. Update the occupant mapping (close the old row, insert the new one).
7. Require password change and MFA re-enrollment on the new occupant's
   first login.

Unchanged by this sequence: the official email/mailbox, resolved
permissions, and audit history — reassignment resets who can log in,
never what the account is or did. Even if implemented as a saga with
compensating steps across systems (session store, mailbox provider,
MFA provider), the operation must present as atomic.

## Audit identity is separate from actor identity
Every audit event records four distinct fields, not one "acted as"
string: **Actor User** (`user_id`, the real person), **Acting
Institutional Position Account** (`position_account_id`, null for
person-centric-only actions), **Business Position** (`position_id`,
for querying history independent of who occupied it when), and
**Timestamp/Action/Resource**. This is what makes "Approved by:
Position — Principal · Acting Person — Dr. Arun Kumar" possible instead
of collapsing to only one half of that fact.

## Alternatives considered
- **`Position → User` directly** (no separate account entity):
  rejected — there is nothing for a credential, session, or revocation
  to attach to that isn't the person's own `users` row, which silently
  collapses position-centric and person-centric identity into one
  thing and makes "occupant changes, account remains" impossible to
  implement rather than just assumed.
- **Reassignment as a best-effort multi-step process** (reset
  password, separately revoke sessions "when convenient"): rejected —
  a partial handover (e.g. password reset but old sessions still live)
  is a real security gap, not a cosmetic one.

## Reasoning
This is the schema and lifecycle foundation the rest of the identity
migration depends on (see `Identity-Migration-Plan.md`, Phase 1 and
Phase 7) — dual-login, immediate handover cutover, and audit
correctness are all consequences of this model, not features bolted on
separately.

## Consequences
- New tables: `position_accounts`, `position_occupants` (see Phase 1
  of the migration plan for the full shape).
- `token_version`/refresh-token revocation must exist per
  `position_account`, not only per `users` row (see ADR-024).
- Every audit-logging call site must record `position_account_id` and
  `position_id` alongside `user_id` going forward.
