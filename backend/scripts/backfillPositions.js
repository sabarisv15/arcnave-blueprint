'use strict';

// CLI entry point for Identity-Migration-Plan.md Phase 2 / ADR-025's
// backfill job. Thin by design — same shape as scripts/migrate.js: all
// real logic lives in services/positionBackfillService.js, this file
// only wires up the MIGRATION_DATABASE_URL connection (arcnave_admin —
// the backfill is inherently cross-tenant) and prints a report.
//
// Usage:
//   node scripts/backfillPositions.js --dry-run
//   node scripts/backfillPositions.js
//   node scripts/backfillPositions.js --batch-id=<uuid>   (rerun/resume with an explicit batch id)

const { Pool } = require('pg');
const positionBackfillService = require('../src/services/positionBackfillService');

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const batchArg = argv.find((a) => a.startsWith('--batch-id='));
  const batchId = batchArg ? batchArg.split('=')[1] : undefined;
  return { dryRun, batchId };
}

async function main() {
  const { dryRun, batchId } = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });

  try {
    const report = await positionBackfillService.runBackfill(pool, { dryRun, batchId });
    console.log(JSON.stringify(report, null, 2));
    console.log(
      `\n${dryRun ? 'DRY RUN' : 'BACKFILL'} complete — batch ${report.batchId}, ${report.collegesProcessed} college(s) processed.`,
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
