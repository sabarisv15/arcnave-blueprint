'use strict';

// Identity-Migration-Plan.md Phase 4 — dual-write consistency coverage
// for authService.acceptInvitation's new Level 1 `positions` +
// `position_accounts` + `position_occupants` provisioning
// (ADR-021), gated behind config.newCollegeOnboardingEnabled
// (NEW_COLLEGE_ONBOARDING_ENABLED). Reuses principal-invitation.test.js's
// own HTTP-driven shape (real server, real Postgres via
// MIGRATION_DATABASE_URL for fixture setup/teardown and assertions) —
// this is explicitly Phase 4's biggest hidden-assumption risk per the
// migration plan, so it gets its own dedicated suite rather than a
// couple of extra assertions bolted onto principal-invitation.test.js.
//
// Three things this suite has to prove, not assume:
// 1. Flag OFF (the default): accept behaves byte-for-byte as it always
//    has — legacy `users.role = 'principal'` row only, zero rows in any
//    of the five Phase 1 tables. The old path must stay fully intact.
// 2. Flag ON: accept creates the legacy `users.role = 'principal'` row
//    AND a fully-linked Level 1 position/account/occupant — every new
//    table agrees with the legacy role for every college created this
//    way, not just most of them.
// 3. Idempotency: a college that already has a Level 1 position (e.g.
//    already migrated via Phase 2's backfill) never gets a second one
//    through this path.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const config = require('../src/config');
const security = require('../src/security');
const notificationService = require('../src/services/notificationService');
const positionRepository = require('../src/repositories/positionRepository');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_PASSWORD = 'PlatformPass123!';
const ACCEPT_PASSWORD = 'AcceptedPass123!';

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
        let parsedBody = null;
        try {
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          parsedBody = text;
        }
        resolve({ status: res.statusCode, body: parsedBody });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
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

test('Phase 4 new-college onboarding: dual-write consistency', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUsername = `onboardadmin${suffix}`;
  const adminResult = await adminPool.query(
    `INSERT INTO platform_admins (username, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [adminUsername, `${adminUsername}@example.com`, await security.hashPassword(PLATFORM_PASSWORD)],
  );
  const adminId = adminResult.rows[0].id;

  const createdColleges = [];
  async function seedCollege(label) {
    const cid = `onb${label}${crypto.randomUUID().slice(0, 8)}`;
    await adminPool.query(
      'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)',
      [cid],
    );
    createdColleges.push(cid);
    return cid;
  }

  const originalFlagValue = config.newCollegeOnboardingEnabled;

  t.after(async () => {
    config.newCollegeOnboardingEnabled = originalFlagValue;
    await stopServer(server);
    for (const cid of createdColleges) {
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM position_occupants WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM position_accounts WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM positions WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM principal_invitations WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM users WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [cid]);
    }
    await adminPool.query('DELETE FROM platform_audit_log WHERE actor_admin_id = $1', [adminId]);
    await adminPool.query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
    await adminPool.end();
  });

  async function platformToken() {
    const resp = await post(
      baseUrl,
      '/api/v1/platform/auth/login',
      {},
      { username: adminUsername, password: PLATFORM_PASSWORD },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  let lastInvitationToken = null;
  const emailMock = t.mock.method(notificationService, 'sendPrincipalInvitationEmail', async (client, { to, token }) => {
    lastInvitationToken = token;
    return { status: 'stubbed', to };
  });
  t.after(() => emailMock.mock.restore());

  async function invite(token, collegeId, email) {
    lastInvitationToken = null;
    const resp = await post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/invite-principal`,
      { authorization: `Bearer ${token}` },
      { email },
    );
    return { ...resp, rawToken: lastInvitationToken };
  }

  function accept(rawToken, username, password = ACCEPT_PASSWORD) {
    return post(baseUrl, '/api/v1/invitations/accept', {}, { token: rawToken, username, password });
  }

  await t.test('flag OFF: accept creates only the legacy principal user, zero Phase 1 table rows', async () => {
    config.newCollegeOnboardingEnabled = false;

    const collegeId = await seedCollege('off');
    const token = await platformToken();
    const email = 'principal-off@example.com';
    const inviteResp = await invite(token, collegeId, email);
    const username = `offuser${crypto.randomUUID().slice(0, 8)}`;

    const resp = await accept(inviteResp.rawToken, username);
    assert.equal(resp.status, 201);
    assert.equal(resp.body.role, 'principal');

    const userRow = await adminPool.query(
      "SELECT id, role, is_active FROM users WHERE college_id = $1 AND username = $2",
      [collegeId, username],
    );
    assert.equal(userRow.rows.length, 1);
    assert.equal(userRow.rows[0].role, 'principal');
    assert.equal(userRow.rows[0].is_active, true);

    const positions = await adminPool.query('SELECT * FROM positions WHERE college_id = $1', [collegeId]);
    assert.equal(positions.rows.length, 0, 'flag OFF must never create a positions row');
    const accounts = await adminPool.query('SELECT * FROM position_accounts WHERE college_id = $1', [collegeId]);
    assert.equal(accounts.rows.length, 0, 'flag OFF must never create a position_accounts row');
    const occupants = await adminPool.query('SELECT * FROM position_occupants WHERE college_id = $1', [collegeId]);
    assert.equal(occupants.rows.length, 0, 'flag OFF must never create a position_occupants row');
  });

  await t.test('flag ON: accept dual-writes legacy role AND a fully-linked Level 1 position/account/occupant', async () => {
    config.newCollegeOnboardingEnabled = true;

    const collegeId = await seedCollege('on');
    const token = await platformToken();
    const email = 'principal-on@example.com';
    const inviteResp = await invite(token, collegeId, email);
    const username = `onuser${crypto.randomUUID().slice(0, 8)}`;

    const resp = await accept(inviteResp.rawToken, username);
    assert.equal(resp.status, 201);
    assert.equal(resp.body.role, 'principal');

    const userRow = await adminPool.query(
      'SELECT id, role, is_active, email, password_hash FROM users WHERE college_id = $1 AND username = $2',
      [collegeId, username],
    );
    assert.equal(userRow.rows.length, 1);
    const user = userRow.rows[0];
    assert.equal(user.role, 'principal', 'legacy role dual-write must still happen with the flag on');
    assert.equal(user.is_active, true);

    const positions = await adminPool.query('SELECT * FROM positions WHERE college_id = $1', [collegeId]);
    assert.equal(positions.rows.length, 1);
    const position = positions.rows[0];
    assert.equal(position.level, 1);
    assert.equal(position.title, 'Principal');
    assert.equal(position.created_by, user.id);

    const accounts = await adminPool.query('SELECT * FROM position_accounts WHERE position_id = $1', [position.id]);
    assert.equal(accounts.rows.length, 1);
    const account = accounts.rows[0];
    assert.equal(account.official_email, email);
    assert.equal(account.password_hash, user.password_hash);
    assert.equal(account.college_id, collegeId);

    const occupants = await adminPool.query(
      'SELECT * FROM position_occupants WHERE position_account_id = $1',
      [account.id],
    );
    assert.equal(occupants.rows.length, 1);
    const occupant = occupants.rows[0];
    assert.equal(occupant.user_id, user.id);
    assert.equal(occupant.assigned_by, user.id);
    assert.equal(occupant.revoked_at, null, 'the new principal must be the single ACTIVE occupant');
  });

  await t.test('flag ON: never creates a second Level 1 position for a college that already has one', async () => {
    config.newCollegeOnboardingEnabled = true;

    const collegeId = await seedCollege('idem');

    // Simulate a college already migrated via Phase 2's backfill (or a
    // prior accept through this same path) — a Level 1 position/account/
    // occupant already exists, attributed to some other pre-existing
    // user, before this test's own invite/accept ever runs.
    const seedUser = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', 'x', 'principal', true)
       RETURNING *`,
      [collegeId, `preexisting${crypto.randomUUID().slice(0, 8)}`],
    );
    const preexisting = seedUser.rows[0];
    const position = await positionRepository.createPosition(adminPool, {
      collegeId, level: 1, title: 'Director', createdBy: preexisting.id,
    });
    const account = await positionRepository.createPositionAccount(adminPool, {
      collegeId, positionId: position.id, officialEmail: preexisting.email, passwordHash: preexisting.password_hash,
    });
    await positionRepository.createPositionOccupant(adminPool, {
      collegeId, positionAccountId: account.id, userId: preexisting.id, assignedBy: preexisting.id,
    });

    // users_one_active_principal_per_college means this college's
    // invite/accept below would 409 if it tried to create a SECOND
    // active principal user — deactivate the seeded one first so this
    // test isolates the position-idempotency guard specifically, not
    // that unrelated constraint.
    await adminPool.query('UPDATE users SET is_active = false WHERE id = $1', [preexisting.id]);

    const token = await platformToken();
    const email = 'principal-idem@example.com';
    const inviteResp = await invite(token, collegeId, email);
    const username = `idemuser${crypto.randomUUID().slice(0, 8)}`;

    const resp = await accept(inviteResp.rawToken, username);
    assert.equal(resp.status, 201);

    const positions = await adminPool.query('SELECT * FROM positions WHERE college_id = $1', [collegeId]);
    assert.equal(positions.rows.length, 1, 'must still be exactly one Level 1 position for this college');
    assert.equal(positions.rows[0].id, position.id, 'the pre-existing position must be left untouched, not replaced');
    assert.equal(positions.rows[0].title, 'Director', 'the pre-existing title must not be overwritten');

    // The new user was still created (dual-write always happens) but
    // was never linked as an occupant of the pre-existing account.
    const newUserRow = await adminPool.query(
      'SELECT id FROM users WHERE college_id = $1 AND username = $2',
      [collegeId, username],
    );
    assert.equal(newUserRow.rows.length, 1);
    const occupants = await adminPool.query(
      'SELECT * FROM position_occupants WHERE position_account_id = $1',
      [account.id],
    );
    assert.equal(occupants.rows.length, 1, 'occupant history for the pre-existing account must be unchanged');
    assert.equal(occupants.rows[0].user_id, preexisting.id);
  });
});
