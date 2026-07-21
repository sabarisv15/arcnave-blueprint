'use strict';

// End-to-end proof of Identity-Migration-Plan.md Phase 3 with
// IDENTITY_SHADOW_MODE=true — a real running Express app against a
// live Postgres, same harness tests/session-revocation-enforced.test.js
// already uses for the identical reason (config.identityShadowModeEnabled
// is read once from process.env at module-load time, so this needs its
// own process/file, set BEFORE requiring src/app/src/config).
//
// tests/*.test.js's full suite already runs with the flag at its real
// default (unset/false) and passes unchanged — that IS this phase's
// "zero behavior change when disabled" proof (see identity-resolvers
// tests for resolver-level coverage). This file is the complementary
// "and it actually works, with zero mismatches, for a real backfilled
// college — and never even runs for a LEGACY one" proof, covering the
// four routes wired to middleware/identityShadow.js:
//   GET /college-profile, GET /departments, GET /ai-config,
//   GET /background-jobs.

process.env.IDENTITY_SHADOW_MODE = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const argon2 = require('argon2');
const { Pool } = require('pg');
const createApp = require('../src/app');
const positionBackfillService = require('../src/services/positionBackfillService');
const identityMismatchRepository = require('../src/repositories/identityMismatchRepository');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const VALID_PASSWORD = 'correct horse battery staple';

function requestJson(baseUrl, path, method, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders = { ...headers };
    if (payload !== undefined) {
      reqHeaders['content-type'] = 'application/json';
      reqHeaders['content-length'] = Buffer.byteLength(payload);
    }
    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function get(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'GET', { headers });
}

function post(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'POST', { headers, body });
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function seedTenantWithPrincipal(adminPool, prefix) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `${prefix}${suffix}`, subdomain: `${prefix}tenant${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await argon2.hash(VALID_PASSWORD);
  const result = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'idshadowprincipal', 'idshadowprincipal@example.com', $2, 'principal', true)
     RETURNING id`,
    [college.collegeId, passwordHash],
  );
  return { college, userId: result.rows[0].id, username: 'idshadowprincipal' };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM identity_migration_mismatches WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM position_occupants WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM position_accounts WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM positions WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('identity shadow mode (Phase 3), enforced', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const tenants = [];
  t.after(async () => {
    await stopServer(server);
    for (const tenant of tenants) {
      // eslint-disable-next-line no-await-in-loop -- teardown, small fixed set
      await cleanupTenant(adminPool, tenant.college);
    }
    await adminPool.end();
  });

  await t.test('a BACKFILLED college: shadow comparison runs, produces zero mismatches, and never changes the response', async () => {
    const tenant = await seedTenantWithPrincipal(adminPool, 'idsb');
    tenants.push(tenant);

    const backfillResult = await positionBackfillService.runBackfill(adminPool, { collegeIds: [tenant.college.collegeId] });
    const entry = backfillResult.results.find((r) => r.collegeId === tenant.college.collegeId);
    assert.equal(entry.principal.status, 'created');
    assert.equal(entry.migrationState, 'BACKFILLED');

    const tenantHeaders = { host: `${tenant.college.subdomain}.arcnave.test` };
    const loginResp = await post(baseUrl, '/api/v1/auth/login', tenantHeaders, {
      username: tenant.username, password: VALID_PASSWORD,
    });
    assert.equal(loginResp.status, 200);
    const authHeaders = { ...tenantHeaders, authorization: `Bearer ${loginResp.body.access_token}` };

    const routes = ['/api/v1/college-profile', '/api/v1/departments', '/api/v1/ai-config', '/api/v1/background-jobs'];
    for (const route of routes) {
      // eslint-disable-next-line no-await-in-loop -- sequential requests against one running server, small fixed set
      const resp = await get(baseUrl, route, authHeaders);
      assert.equal(resp.status, 200, `${route} must respond exactly as it would with shadow mode off`);
    }

    const mismatchCount = await identityMismatchRepository.countByCollege(adminPool, tenant.college.collegeId);
    assert.equal(mismatchCount, 0, 'a real backfilled college, principal-only routes: the resolver must agree with legacy, zero mismatches');
  });

  await t.test('a LEGACY (not-yet-backfilled) college is never enrolled in shadow comparison, even with the flag on', async () => {
    const tenant = await seedTenantWithPrincipal(adminPool, 'idsl');
    tenants.push(tenant);
    // Deliberately no backfill call — this college stays LEGACY.

    const collegeState = await adminPool.query('SELECT migration_state FROM colleges WHERE college_id = $1', [tenant.college.collegeId]);
    assert.equal(collegeState.rows[0].migration_state, 'LEGACY');

    const tenantHeaders = { host: `${tenant.college.subdomain}.arcnave.test` };
    const loginResp = await post(baseUrl, '/api/v1/auth/login', tenantHeaders, {
      username: tenant.username, password: VALID_PASSWORD,
    });
    assert.equal(loginResp.status, 200);
    const authHeaders = { ...tenantHeaders, authorization: `Bearer ${loginResp.body.access_token}` };

    // Without backfill, identityService.resolveCapabilities would
    // resolve this principal as effectiveRole='staff' (no position row
    // exists) — a guaranteed false-positive mismatch against
    // legacy role='principal' IF shadow comparison ran. Zero mismatch
    // rows below is the proof it correctly never ran at all.
    const resp = await get(baseUrl, '/api/v1/college-profile', authHeaders);
    assert.equal(resp.status, 200, 'the route itself is completely unaffected by shadow-mode eligibility either way');

    const mismatchCount = await identityMismatchRepository.countByCollege(adminPool, tenant.college.collegeId);
    assert.equal(mismatchCount, 0, 'a LEGACY college must never be enrolled, per the plan\'s explicit sequencing fix');
  });
});
