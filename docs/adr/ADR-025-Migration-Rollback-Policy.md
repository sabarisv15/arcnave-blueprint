# ADR-025: Backfill and migration rollback policy

Status: Superseded — no production deployment exists yet; backfill/rollback
tooling isn't needed for a greenfield system. Revisit if/when a real
migration (e.g. upgrading a live pilot college) is ever needed.

## Decision
Backfilling existing colleges into the [[ADR-021-Institutional-Position-Account-Model]]
schema (Phase 2 of the identity migration plan) runs as a **per-college,
idempotent, tagged, resumable batch job** — never a single cross-college
transaction, never a blind/untagged write.

- **Idempotent**: for each college, find-or-create semantics keyed on
  the legacy source row (`users.id` for the active Principal/HOD).
  Re-running the job for an already-backfilled college is a no-op, not
  a duplicate-row error.
- **Tagged**: every row the backfill creates carries a
  `migration_batch_id` (one UUID per job run). Nothing else in the
  system ever writes this column. This is what makes rollback safe —
  the unbackfill script deletes only rows matching a given batch id,
  never a blind `DELETE FROM positions WHERE college_id = ?`, so it
  can never remove legitimate data created afterward through Phase 4's
  Create/Edit College UI for the same college.
- **Batched per college, not globally**: one DB transaction per
  college. A failure partway through the full run leaves already-
  completed colleges backfilled and untouched colleges untouched —
  never a half-migrated single college.
- **Resumable via College Migration State**: reuses the plan's
  existing `LEGACY → BACKFILLED → ...` state column (one queryable
  fact per college) rather than a separate `backfill_status` marker —
  the job's own resume logic is "process every college still in
  `LEGACY`," so a killed/restarted run just picks up where it left
  off with no separate bookkeeping table.
- **Dry-run mode**: the job accepts a flag that reports what it would
  create per college (source rows found, positions/accounts/occupants
  that would result) without writing anything. Required to run clean
  against a production snapshot before the job runs for real.

## Mapping rule (what actually gets backfilled)
Per college: the active `users.role = 'principal'` row (enforced
unique today by `users_one_active_principal_per_college`) becomes a
Level 1 `positions` + `position_accounts` + `position_occupants` row.
Per department: the active `users.role = 'hod'` row for that
department (`users_one_active_hod_per_department`) — or, if none
exists, the active row from `hod_in_charge_appointments` — becomes the
Level 3 position's current occupant. No special-casing for "acting"
HODs is needed in the new schema: per ADR-021, occupancy is uniformly
append-only, so a temporary HOD-in-Charge is simply today's occupant
of that department's position account, exactly like a permanent HOD
would be.

## Alternatives considered
- **One big transaction across all colleges**: rejected — a single
  failure would roll back every college's progress, and a stuck lock
  on one college's data would block all others.
- **Untagged writes, rollback via manual SQL review**: rejected — too
  easy to accidentally delete legitimate post-backfill data (e.g. a
  new Level 2 position a college created through Phase 4 after their
  backfill ran); tagging makes rollback mechanical and safe by
  construction instead of relying on careful manual review under time
  pressure.

## Reasoning
This is the first phase of the migration with real data-mutation risk
against production-equivalent data (Phase 0/1 were purely additive
schema with nothing reading it). The policy above is what the
migration plan's Phase 2 exit criteria require: idempotency,
resumability, batching, and a rehearsed reversible path — decided here
as a written policy so the implementation doesn't have to invent these
guarantees ad hoc while writing the backfill script.

## Revisit when
Not expected to change — this is a one-time migration mechanism, not a
long-lived pattern other features need to reuse.

## Consequences
- `migration_batch_id` column added wherever Phase 2 writes
  (`positions`, `position_accounts`, `position_occupants`).
- The backfill job must be rehearsed against a full production data
  snapshot (dry-run, then real run with the unbackfill script verified
  against that same snapshot) before it is ever run against the real
  production database.
- Phase 3 shadow-mode enrollment for a college is gated on that
  college's migration state reaching `BACKFILLED` — never enrolled
  globally at once.
