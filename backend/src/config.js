'use strict';

// Mirrors the old app/core/config.py Settings class's discipline:
// secrets/connection strings have no hardcoded fallback — a missing
// required value fails loudly at startup, not silently at first use.

const path = require('path');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  appName: process.env.APP_NAME || 'ARCNAVE',
  environment: process.env.ENVIRONMENT || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Runtime app connection — must use the least-privilege arcnave_app
  // role, never the migration-owner role. That role is a Postgres
  // superuser (provisioned by the official postgres image) and
  // superusers bypass RLS unconditionally, regardless of FORCE ROW
  // LEVEL SECURITY. This distinction is load bearing, not stylistic.
  // See ADR-015.
  databaseUrl: required('DATABASE_URL'),

  // Migration connection — owns the tables (CREATE TABLE, CREATE
  // POLICY, GRANT). Only used by scripts/migrate.js and by tests that
  // seed/verify fixture data directly (bypassing RLS on purpose, as
  // the negative control) — never by application routes.
  migrationDatabaseUrl: required('MIGRATION_DATABASE_URL'),

  // Platform (Super Admin Portal) DB connection — arcnave_platform, a
  // separate least-privilege role from arcnave_app, granted only on
  // platform_admins/colleges/principal_invitations (see the ported
  // migrations). Not wired into any route yet in this pass — the
  // Platform API is rebuilt in a later follow-up, same as Module 0's
  // original build order. Required here now so the three-role
  // connection separation (ADR-015) exists in the app's config from
  // the start, matching how it's wired in docker-compose.yml, rather
  // than being bolted on later.
  platformDatabaseUrl: required('PLATFORM_DATABASE_URL'),

  // Signs/verifies access JWTs. A real secret, required — no default,
  // same reasoning as databaseUrl: a hardcoded fallback here would be
  // a hardcoded auth bypass waiting to happen in prod.
  jwtSecretKey: required('JWT_SECRET_KEY'),
  jwtAlgorithm: process.env.JWT_ALGORITHM || 'HS256',
  accessTokenExpireMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES) || 15,
  // Refresh tokens are opaque, stored server-side as token_hash only
  // (never the raw token) — see src/security.js.
  refreshTokenExpireDays: Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS) || 30,

  // Signs/verifies platform-admin access JWTs. Deliberately a
  // DIFFERENT secret from jwtSecretKey, required, no fallback to it:
  // a platform token and a tenant token must never verify against the
  // same key, or a leaked tenant token plus a signature bug could be
  // mistaken for platform access. See security.js's
  // createPlatformAccessToken/decodePlatformAccessToken.
  platformJwtSecretKey: required('PLATFORM_JWT_SECRET_KEY'),

  // How long a principal-invitation token (services/platformService.js
  // invitePrincipal) stays acceptable. A safe default, not a business
  // rule yet — nothing in BusinessRules.md specifies this.
  principalInvitationExpireHours: Number(process.env.PRINCIPAL_INVITATION_EXPIRE_HOURS) || 72,

  // Local-disk root DocumentService writes uploaded files under (see
  // ADR-017). Not a secret — a plain path, defaulted like appName/
  // logLevel rather than required() like the connection strings above.
  // docker-compose.yml does not yet mount a persistent volume here —
  // a flagged gap, not solved by this default (see ADR-017's
  // Consequences).
  documentStorageRoot: process.env.DOCUMENT_STORAGE_ROOT || path.join(__dirname, '../storage'),

  // NotificationService's real email channel (Module 8). Deliberately
  // NOT required() like the connection strings/JWT secrets above:
  // this session's own task asks for "a stub/log-only fallback if no
  // provider is configured," so an unset SMTP_HOST must not crash
  // startup — notificationService.js checks for this exact null and
  // logs instead of attempting to send. host has no default at all
  // (empty string/undefined both mean "unconfigured"); the rest have
  // reasonable defaults so a caller only needs to set host+credentials
  // to turn the real channel on.
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || null,
    password: process.env.SMTP_PASSWORD || null,
    fromAddress: process.env.SMTP_FROM_ADDRESS || 'no-reply@arcnave.local',
  },
};
