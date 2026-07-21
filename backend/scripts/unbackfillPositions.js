'use strict';

// CLI entry point for ADR-025's unbackfill/rollback script — deletes
// only rows tagged with the given migration_batch_id and moves each
// affected college's migration_state back to LEGACY. See
// services/positionBackfillService.js's runUnbackfill for the actual
// safety logic (refuses to touch a college that isn't currently
// BACKFILLED).
//
// Usage:
//   node scripts/unbackfillPositions.js --batch-id=<uuid>

const { Pool } = require('pg');
const positionBackfillService = require('../src/services/positionBackfillService');

function parseArgs(argv) {
  const batchArg = argv.find((a) => a.startsWith('--batch-id='));
  const batchId = batchArg ? batchArg.split('=')[1] : undefined;
  return { batchId };
}

async function main() {
  const { batchId } = parseArgs(process.argv.slice(2));
  if (!batchId) {
    console.error('Usage: node scripts/unbackfillPositions.js --batch-id=<uuid>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    const report = await positionBackfillService.runUnbackfill(pool, { batchId });
    console.log(JSON.stringify(report, null, 2));
    console.log(
      `\nUNBACKFILL complete — batch ${report.batchId}: ${report.positionsDeleted} position(s), `
      + `${report.accountsDeleted} account(s), ${report.occupantsDeleted} occupant(s) deleted across `
      + `${report.collegeIds.length} college(s), all reverted to LEGACY.`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
