# ADR-021: Institutional Position Account Model

Status: Accepted, amended (Phase 2, 2026-07-22 — see "Amendments" below)

## Decision
The identity model is `Position → Institutional Position Account →
Current Occupant` — three distinct things, never `Position → User`.

- **Position** — the organizational seat (Level, title, college_id).
  Levels 1 and 3 are platform-defined structural positions; Level 2
  positions are created and configured by Level 1; Level 4 is
  person-centric (see [[Identity-Organization-Model]]) and, in the
  general case, not part of this account model — **narrow carve-out**:
  a Level 4 position row CAN exist when it carries a real
  `position_type` assignment (e.g. `'class_tutor'`); see "Amendments".
  Plain staff with no such assignment still get zero Position rows.
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
4. Reset credentials — issue a fresh invite (**amended, see below**;
   originally "issue a temporary password").
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
model depends on — dual-login, immediate handover cutover, and audit
correctness are all consequences of this model, not features bolted on
separately.

## Amendments (Phase 2, `docs/architecture/Phase2-Position-Account-Auth-Plan.md`)

**1. Level 4 `position_type='class_tutor'` carve-out.** Class Tutor —
previously a bare `classes.tutor_user_id` FK, global-UNIQUE, no
Position/Account/Occupant model at all — became a full Position
Account, following this ADR's model exactly one level down from HOD:
Level 4 + a new `positions.position_type` column set to `'class_tutor'`.
This is deliberately **not a new level** — `positions.level`'s
`1-4` CHECK is unchanged. Levels represent organizational hierarchy;
Class Tutor (like the future Placement Coordinator, NSS Coordinator,
Library In-charge, Exam Cell assignments `position_type` leaves room
for) is an *assignment* a Level 4 Staff position carries, orthogonal to
level. Plain Level 4 staff — no assignment, no `position_type` — still
get zero Position rows, exactly as this ADR originally specified.
Assignment/reassignment of a `class_tutor` position is HOD-only, scoped
to the HOD's own department. A new `position_class_assignments` table
(mirroring `position_department_assignments`) links a `class_tutor`
position to its class.

**2. Reassignment credential reset is invite-based, not a mailed
temporary password.** Step 4 of the lifecycle above originally read
"issue a temporary password." Implementation instead reuses the same
invite/accept mechanism first-time bootstrap already uses (a fresh
`position_account_invitations` row, emailed, accepted through the
ordinary accept flow) — the incoming occupant sets their own real
password, never inheriting a system-generated one or the outgoing
occupant's. Chosen for consistency with how every other credential
bootstrap in this model already works, not as a security-motivated
change to the lifecycle's intent (still: old credentials/sessions dead
immediately, new occupant must set fresh credentials before first use).
All other lifecycle steps (1-3, 5-7) are unchanged and were implemented
exactly as specified, uniformly across Level 1/2/3 and the Class Tutor
assignment via one shared function
(`positionAccountInvitationService.reassignPositionOccupant`), not
per-type copies.

See [[ADR-023-Institutional-Capability-Resolver]] for the companion
resolution-layer decision (`resolveCapabilitiesForPosition`) this phase
also introduced — a separate ADR, not a further amendment to this one,
since it extends ADR-022's contract rather than this ADR's data model.

## Consequences
- New tables: `position_accounts`, `position_occupants`, and (Phase 2)
  `position_class_assignments`, `position_account_invitations`,
  `position_account_refresh_tokens`.
- `token_version`/refresh-token revocation must exist per
  `position_account`, not only per `users` row (see ADR-024).
- Every audit-logging call site must record `position_account_id` and
  `position_id` alongside `user_id` going forward.
- (Phase 2) `positions.position_type` (nullable) distinguishes an
  assignment-bearing Level 4 position from plain staff; no DB-level
  enum, since the value space is expected to grow.
