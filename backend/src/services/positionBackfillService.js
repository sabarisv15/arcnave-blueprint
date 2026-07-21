'use strict';

// Identity-Migration-Plan.md Phase 2 / ADR-025 (Migration Rollback
// Policy) — the backfill orchestration itself. Query mechanics live in
// collegeMigrationRepository.js / positionRepository.js /
// hodInChargeRepository.js; this file owns the actual decisions:
// idempotency, per-college transaction boundaries, batch tagging,
// dry-run reporting, and the college_migration_state transition.
//
// Mapping rule (ADR-025): per college, the active
// `users.role = 'principal'` row becomes a Level 1 position + account
// + occupant. Per department, the active `users.role = 'hod'` row
// (mirrored via users.active_hod_department_id, see
// 1753800000000_single-active-hod.js) — or, if none, the active
// hod_in_charge_appointments row for that department — becomes the
// Level 3 position's current occupant. No special-casing for "acting"
// HODs: per ADR-021, occupancy is uniformly append-only, so a
// temporary HOD-in-Charge is simply today's occupant, exactly like a
// permanent HOD.
//
// Credentials: the backfilled position_accounts row inherits the
// legacy user's own password_hash and email as its starting point —
// nothing reads these tables yet (no login path wired to them, that's
// Phase 3+/Phase 7 work), so there is no real credential to mint here;
// re-issuing a temporary password is Phase 7's reassignment lifecycle,
// not this one-time backfill's job.
//
// created_by / assigned_by: this codebase has no "system actor"
// concept (audit_log.user_id is nullable, but positions.created_by and
// position_occupants.assigned_by are NOT NULL FKs to users, by design
// — Phase 1 chose not to allow an attributionless position/occupant
// row). Backfilled rows attribute creation to the person the row is
// *for* (the principal creates/occupies their own backfilled Level 1
// account, a HOD their own Level 3 account) — the only actor that is
// guaranteed to exist and be meaningful for every college without
// inventing a new schema concept for this one-time job.
//
// Batching (ADR-025): one DB transaction per college, never one
// giant transaction — a failure partway through the full run leaves
// already-completed colleges backfilled and untouched colleges
// untouched. Resumability comes for free from the college_migration_state
// column: the outer loop only ever processes colleges still LEGACY, so
// a killed/restarted run just picks up where it left off. Each
// college's transaction also SELECT ... FOR UPDATE-locks the college
// row and re-checks migration_state === 'LEGACY' before doing
// anything, so two concurrent runs can never double-backfill the same
// college.

const crypto = require('crypto');
const positionRepository = require('../repositories/positionRepository');
const collegeMigrationRepository = require('../repositories/collegeMigrationRepository');
const hodInChargeRepository = require('../repositories/hodInChargeRepository');

const PRINCIPAL_LEVEL = 1;
const HOD_LEVEL = 3;

async function resolveHodOccupant(client, collegeId, department) {
  const hodUser = await collegeMigrationRepository.findActiveHodUser(client, collegeId, department.id);
  if (hodUser) {
    return { user: hodUser, source: 'hod-role' };
  }

  const appointment = await hodInChargeRepository.findActiveForDepartment(client, collegeId, department.id);
  if (!appointment) {
    return { user: null, source: 'none' };
  }

  const facultyUser = await collegeMigrationRepository.findUserById(client, appointment.faculty_user_id);
  return { user: facultyUser, source: 'hod-in-charge' };
}

async function backfillPrincipal(client, collegeId, { dryRun, batchId }) {
  const principal = await collegeMigrationRepository.findActivePrincipal(client, collegeId);
  if (!principal) {
    return { status: 'no-active-principal' };
  }

  const existing = await positionRepository.findActiveOccupancyForUserAtLevel(client, {
    collegeId, level: PRINCIPAL_LEVEL, userId: principal.id,
  });
  if (existing) {
    return { status: 'already-backfilled', userId: principal.id };
  }

  if (dryRun) {
    return { status: 'would-create', userId: principal.id };
  }

  const position = await positionRepository.createPosition(client, {
    collegeId, level: PRINCIPAL_LEVEL, title: 'Principal', createdBy: principal.id, migrationBatchId: batchId,
  });
  const account = await positionRepository.createPositionAccount(client, {
    collegeId,
    positionId: position.id,
    officialEmail: principal.email,
    passwordHash: principal.password_hash,
    migrationBatchId: batchId,
  });
  await positionRepository.createPositionOccupant(client, {
    collegeId,
    positionAccountId: account.id,
    userId: principal.id,
    assignedBy: principal.id,
    migrationBatchId: batchId,
  });

  return { status: 'created', userId: principal.id };
}

async function backfillDepartment(client, collegeId, department, { dryRun, batchId }) {
  const { user: hodUser, source } = await resolveHodOccupant(client, collegeId, department);
  if (!hodUser) {
    return {
      departmentId: department.id, name: department.name, status: 'no-active-hod', source,
    };
  }

  const existing = await positionRepository.findActiveOccupancyForUserAtLevel(client, {
    collegeId, level: HOD_LEVEL, userId: hodUser.id,
  });
  if (existing) {
    return {
      departmentId: department.id, name: department.name, status: 'already-backfilled', source, userId: hodUser.id,
    };
  }

  if (dryRun) {
    return {
      departmentId: department.id, name: department.name, status: 'would-create', source, userId: hodUser.id,
    };
  }

  const position = await positionRepository.createPosition(client, {
    collegeId, level: HOD_LEVEL, title: `HOD — ${department.name}`, createdBy: hodUser.id, migrationBatchId: batchId,
  });
  const account = await positionRepository.createPositionAccount(client, {
    collegeId,
    positionId: position.id,
    officialEmail: hodUser.email,
    passwordHash: hodUser.password_hash,
    migrationBatchId: batchId,
  });
  await positionRepository.createPositionOccupant(client, {
    collegeId,
    positionAccountId: account.id,
    userId: hodUser.id,
    assignedBy: hodUser.id,
    migrationBatchId: batchId,
  });

  return {
    departmentId: department.id, name: department.name, status: 'created', source, userId: hodUser.id,
  };
}

async function processCollege(pool, collegeId, { dryRun, batchId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await collegeMigrationRepository.lockCollege(client, collegeId);
    if (!locked || locked.migration_state !== 'LEGACY') {
      await client.query('ROLLBACK');
      return {
        collegeId, skipped: true, reason: locked ? `migration_state is ${locked.migration_state}, not LEGACY` : 'college not found',
      };
    }

    const principal = await backfillPrincipal(client, collegeId, { dryRun, batchId });
    const departments = await collegeMigrationRepository.findDepartments(client, collegeId);
    const departmentResults = [];
    for (const department of departments) {
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose, one college's own transaction
      departmentResults.push(await backfillDepartment(client, collegeId, department, { dryRun, batchId }));
    }

    let migrationState = locked.migration_state;
    if (!dryRun) {
      const updated = await collegeMigrationRepository.setMigrationState(client, collegeId, {
        from: 'LEGACY', to: 'BACKFILLED',
      });
      migrationState = updated ? updated.migration_state : locked.migration_state;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    return {
      collegeId, skipped: false, dryRun, principal, departments: departmentResults, migrationState,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { collegeId, error: err.message };
  } finally {
    client.release();
  }
}

// Processes every college currently in LEGACY state. Resumable by
// construction — a killed/restarted run just re-queries LEGACY
// colleges and picks up where it left off; already-BACKFILLED colleges
// are simply absent from that query on the next run.
//
// `collegeIds` is an optional explicit override, scoped to a known set
// of colleges instead of the full "every LEGACY college" sweep — the
// production CLI never passes this (it always wants the full sweep),
// but it exists so a caller (tests, or an operator resuming a specific
// subset) can run the exact same logic against a bounded scope without
// touching every other LEGACY college that happens to exist in the
// same database at that moment. Each college is still independently
// re-checked for LEGACY state inside its own transaction either way.
async function runBackfill(pool, { dryRun = false, batchId, collegeIds } = {}) {
  const effectiveBatchId = batchId || crypto.randomUUID();
  const targetCollegeIds = collegeIds
    || await collegeMigrationRepository.findCollegesByMigrationState(pool, 'LEGACY');

  const results = [];
  for (const collegeId of targetCollegeIds) {
    // eslint-disable-next-line no-await-in-loop -- one DB transaction per college, deliberately sequential (ADR-025: never one giant transaction)
    results.push(await processCollege(pool, collegeId, { dryRun, batchId: effectiveBatchId }));
  }

  return { batchId: effectiveBatchId, dryRun, collegesProcessed: results.length, results };
}

// Deletes only rows tagged with this exact batch id and moves each
// affected college's migration_state back to LEGACY. Fails loudly
// (aborts the whole transaction, deletes nothing) if any affected
// college is not currently BACKFILLED — same "fail loudly, force a
// human decision" precedent as
// 1753400000000_single-active-principal.js, rather than silently
// downgrading a college that has already moved further through the
// migration (e.g. into SHADOW).
async function runUnbackfill(pool, { batchId }) {
  if (!batchId) {
    throw new Error('runUnbackfill requires a batchId');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const collegeIds = await positionRepository.findCollegeIdsForMigrationBatch(client, batchId);
    for (const collegeId of collegeIds) {
      // eslint-disable-next-line no-await-in-loop -- small set, sequential is fine, single transaction for this operator-invoked rollback
      const locked = await collegeMigrationRepository.lockCollege(client, collegeId);
      if (!locked || locked.migration_state !== 'BACKFILLED') {
        throw new Error(
          `Refusing to unbackfill batch ${batchId}: college ${collegeId} is ${locked ? locked.migration_state : 'missing'}, not BACKFILLED`,
        );
      }
    }

    const deleted = await positionRepository.deleteByMigrationBatch(client, batchId);

    for (const collegeId of collegeIds) {
      // eslint-disable-next-line no-await-in-loop -- see above
      await collegeMigrationRepository.setMigrationState(client, collegeId, { from: 'BACKFILLED', to: 'LEGACY' });
    }

    await client.query('COMMIT');
    return { batchId, collegeIds, ...deleted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runBackfill, runUnbackfill };
