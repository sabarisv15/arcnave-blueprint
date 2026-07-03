'use strict';

// Programmatic node-pg-migrate invocation rather than the bare CLI,
// so the migration connection string comes from MIGRATION_DATABASE_URL
// explicitly (arcnave_admin) — the CLI's default env var is
// DATABASE_URL, which in this project is deliberately the
// least-privilege arcnave_app runtime connection instead. Using the
// programmatic API sidesteps having to rely on a CLI flag name to get
// that redirection right.

const { runner } = require('node-pg-migrate');

const direction = process.argv[2] || 'up';

runner({
  databaseUrl: process.env.MIGRATION_DATABASE_URL,
  dir: 'migrations',
  direction,
  migrationsTable: 'pgmigrations',
  count: Infinity,
  log: (msg) => console.log(msg),
})
  .then(() => {
    console.log(`Migrations (${direction}) complete.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
