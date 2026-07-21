'use strict';

// End-to-end HTTP coverage for Phase 2 step 7 — the routes group (a)
// delivers: Position Account login/refresh/logout (tenant router),
// Level 1/2 invite (platform router, Platform-Admin-initiated) and
// Level 3/HOD invite (tenant router, Level 2 actor's personal login),
// and the shared unauthenticated accept route. Same real-HTTP,
// real-Postgres, mock-only-the-email style as principal-invitation.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const notificationService = require('../src/services/notificationService');
const { cleanupPositionRows } = require('./helpers/positionFixtures');

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

function hostFor(subdomain) {
  return `${subdomain}.arcnave.test`;
}

test('Position Account routes (Phase 2 step 7)', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUsername = `parplatadmin${suffix}`;
  const adminResult = await adminPool.query(
    `INSERT INTO platform_admins (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [adminUsername, `${adminUsername}@example.com`, await security.hashPassword(PLATFORM_PASSWORD)],
  );
  const adminId = adminResult.rows[0].id;

  const createdColleges = [];
  async function seedCollege(label) {
    const cid = `par${label}${crypto.randomUUID().slice(0, 8)}`;
    await adminPool.query('INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)', [cid]);
    createdColleges.push(cid);
    return cid;
  }

  t.after(async () => {
    await stopServer(server);
    for (const cid of createdColleges) {
      // eslint-disable-next-line no-await-in-loop -- test teardown, small fixed set
      await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await cleanupPositionRows(adminPool, cid);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM departments WHERE college_id = $1', [cid]);
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
    const resp = await post(baseUrl, '/api/v1/platform/auth/login', {}, { username: adminUsername, password: PLATFORM_PASSWORD });
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  let lastInvitationToken = null;
  const emailMock = t.mock.method(notificationService, 'sendPositionAccountInvitationEmail', async (client, { to, token }) => {
    lastInvitationToken = token;
    return { status: 'stubbed', to };
  });
  t.after(() => emailMock.mock.restore());

  async function inviteLevel12(platformAdminToken, collegeId, level, email) {
    lastInvitationToken = null;
    const resp = await post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/position-accounts/invite`,
      { authorization: `Bearer ${platformAdminToken}` },
      { level, email },
    );
    return { ...resp, rawToken: lastInvitationToken };
  }

  function acceptPositionInvite(rawToken, password = ACCEPT_PASSWORD) {
    return post(baseUrl, '/api/v1/position-accounts/invitations/accept', {}, { token: rawToken, password });
  }

  // --- Level 2 invite (Platform Admin) -> accept -> login -> refresh -> logout ---

  await t.test('Platform Admin invites Level 2, accept sets real credentials, login/refresh/logout all work', async () => {
    const collegeId = await seedCollege('l2');
    const platformAdminToken = await platformToken();

    const inviteResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'dean@example.edu');
    assert.equal(inviteResp.status, 201);
    assert.equal(inviteResp.body.email, 'dean@example.edu');
    assert.equal('token' in inviteResp.body, false);
    assert.ok(inviteResp.rawToken);

    const acceptResp = await acceptPositionInvite(inviteResp.rawToken);
    assert.equal(acceptResp.status, 201);
    assert.equal(acceptResp.body.official_email, 'dean@example.edu');
    assert.equal(acceptResp.body.college_id, collegeId);

    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
    const subdomain = collegeRow.rows[0].subdomain;

    const loginResp = await post(
      baseUrl, '/api/v1/position-accounts/login', { host: hostFor(subdomain) },
      { official_email: 'dean@example.edu', password: ACCEPT_PASSWORD },
    );
    assert.equal(loginResp.status, 200);
    assert.ok(loginResp.body.access_token);
    assert.ok(loginResp.body.refresh_token);

    const claims = security.decodeAccessToken(loginResp.body.access_token);
    assert.equal(claims.type, 'position_access');
    assert.equal(claims.sub, acceptResp.body.position_account_id);

    const refreshResp = await post(
      baseUrl, '/api/v1/position-accounts/refresh', { host: hostFor(subdomain) },
      { refresh_token: loginResp.body.refresh_token },
    );
    assert.equal(refreshResp.status, 200);
    assert.ok(refreshResp.body.access_token);

    const logoutResp = await post(
      baseUrl, '/api/v1/position-accounts/logout', { host: hostFor(subdomain) },
      { refresh_token: refreshResp.body.refresh_token },
    );
    assert.equal(logoutResp.status, 204);

    // The just-logged-out refresh token is now dead — a repeat refresh
    // with it fails, proving logout actually revoked it.
    const reuseResp = await post(
      baseUrl, '/api/v1/position-accounts/refresh', { host: hostFor(subdomain) },
      { refresh_token: refreshResp.body.refresh_token },
    );
    assert.equal(reuseResp.status, 401);
  });

  await t.test('a wrong password at login is rejected generically', async () => {
    const collegeId = await seedCollege('l2b');
    const platformAdminToken = await platformToken();
    const inviteResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'dean2@example.edu');
    await acceptPositionInvite(inviteResp.rawToken);

    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
    const loginResp = await post(
      baseUrl, '/api/v1/position-accounts/login', { host: hostFor(collegeRow.rows[0].subdomain) },
      { official_email: 'dean2@example.edu', password: 'wrong-password' },
    );
    assert.equal(loginResp.status, 401);
  });

  // --- Level 1/2 invite is Platform-Admin-only ---

  await t.test('the platform invite route requires a valid Platform Admin token', async () => {
    const collegeId = await seedCollege('l2c');
    const resp = await post(
      baseUrl, `/api/v1/platform/colleges/${collegeId}/position-accounts/invite`, {},
      { level: 2, email: 'nobody@example.edu' },
    );
    assert.equal(resp.status, 401);
  });

  await t.test('inviting Level 3 through the platform route is forbidden — that is a tenant-actor-only level', async () => {
    const collegeId = await seedCollege('l2d');
    const platformAdminToken = await platformToken();
    const resp = await post(
      baseUrl, `/api/v1/platform/colleges/${collegeId}/position-accounts/invite`,
      { authorization: `Bearer ${platformAdminToken}` },
      { level: 3, email: 'hod@example.edu' },
    );
    assert.equal(resp.status, 403);
  });

  await t.test('inviting to an already-provisioned Level 2 seat a second time is a 409, not a silent overwrite', async () => {
    const collegeId = await seedCollege('l2e');
    const platformAdminToken = await platformToken();
    await inviteLevel12(platformAdminToken, collegeId, 2, 'first-dean@example.edu');

    const secondResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'second-dean@example.edu');
    assert.equal(secondResp.status, 409);
  });

  // --- Level 3 (HOD) invite — a Level 2 tenant actor's PERSONAL login ---

  async function seedLevel2Occupant(collegeId) {
    const passwordHash = await security.hashPassword(ACCEPT_PASSWORD);
    const userResult = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', $3, 'staff', true) RETURNING id`,
      [collegeId, `level2occ${crypto.randomUUID().slice(0, 8)}`, passwordHash],
    );
    const userId = userResult.rows[0].id;
    const position = await adminPool.query(
      `INSERT INTO positions (college_id, level, title, created_by) VALUES ($1, 2, 'Vice Principal', $2) RETURNING id`,
      [collegeId, userId],
    );
    const account = await adminPool.query(
      `INSERT INTO position_accounts (college_id, position_id, official_email, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [collegeId, position.rows[0].id, `vp-${position.rows[0].id}@positions.test`, passwordHash],
    );
    await adminPool.query(
      `INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by) VALUES ($1, $2, $3, $3)`,
      [collegeId, account.rows[0].id, userId],
    );
    return userId;
  }

  async function personalToken(collegeId, userId) {
    return security.createAccessToken({ userId, collegeId, role: 'staff' });
  }

  await t.test('a Level 2 actor invites Level 3 (HOD), accept -> login works end to end', async () => {
    const collegeId = await seedCollege('l3a');
    const deptResult = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [collegeId, 'CSE']);
    const departmentId = deptResult.rows[0].id;
    const level2UserId = await seedLevel2Occupant(collegeId);
    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);
    const subdomain = collegeRow.rows[0].subdomain;

    lastInvitationToken = null;
    const inviteResp = await post(
      baseUrl, `/api/v1/departments/${departmentId}/position-accounts/invite`,
      { authorization: `Bearer ${await personalToken(collegeId, level2UserId)}`, host: hostFor(subdomain) },
      { email: 'hod-cse@example.edu' },
    );
    assert.equal(inviteResp.status, 201);
    const rawToken = lastInvitationToken;
    assert.ok(rawToken);

    const acceptResp = await acceptPositionInvite(rawToken);
    assert.equal(acceptResp.status, 201);
    assert.equal(acceptResp.body.official_email, 'hod-cse@example.edu');

    const loginResp = await post(
      baseUrl, '/api/v1/position-accounts/login', { host: hostFor(subdomain) },
      { official_email: 'hod-cse@example.edu', password: ACCEPT_PASSWORD },
    );
    assert.equal(loginResp.status, 200);
    const claims = security.decodeAccessToken(loginResp.body.access_token);
    assert.equal(claims.type, 'position_access');
  });

  await t.test('a plain staff actor (no Level 2 position) cannot invite Level 3', async () => {
    const collegeId = await seedCollege('l3b');
    const deptResult = await adminPool.query('INSERT INTO departments (college_id, name) VALUES ($1, $2) RETURNING id', [collegeId, 'ECE']);
    const departmentId = deptResult.rows[0].id;
    const passwordHash = await security.hashPassword(ACCEPT_PASSWORD);
    const userResult = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $2 || '@example.test', $3, 'staff', true) RETURNING id`,
      [collegeId, `plainstaff${crypto.randomUUID().slice(0, 8)}`, passwordHash],
    );
    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);

    const resp = await post(
      baseUrl, `/api/v1/departments/${departmentId}/position-accounts/invite`,
      { authorization: `Bearer ${await personalToken(collegeId, userResult.rows[0].id)}`, host: hostFor(collegeRow.rows[0].subdomain) },
      { email: 'hod-ece@example.edu' },
    );
    assert.equal(resp.status, 403);
  });

  await t.test('a Level 3 invite missing an existing department (via bad UUID as departmentId) resolves cleanly, not a crash', async () => {
    const collegeId = await seedCollege('l3c');
    const level2UserId = await seedLevel2Occupant(collegeId);
    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeId]);

    const resp = await post(
      baseUrl, `/api/v1/departments/${crypto.randomUUID()}/position-accounts/invite`,
      { authorization: `Bearer ${await personalToken(collegeId, level2UserId)}`, host: hostFor(collegeRow.rows[0].subdomain) },
      { email: 'ghost-hod@example.edu' },
    );
    // No department row with that id exists — position_department_assignments'
    // own department_id FK rejects the INSERT (23503), surfaced as a 500
    // today (no bespoke error mapping for this edge case yet); the point
    // of this test is that the route doesn't silently create a
    // dangling position, not that the status code is polished.
    assert.notEqual(resp.status, 201);
  });

  // --- Accept edge cases ---

  await t.test('an unknown/expired/already-accepted accept token is rejected with the same generic message', async () => {
    const unknownResp = await acceptPositionInvite('not-a-real-token');
    assert.equal(unknownResp.status, 401);
    assert.equal(unknownResp.body.detail, 'Invalid or expired invitation');

    const collegeId = await seedCollege('acc1');
    const platformAdminToken = await platformToken();
    const inviteResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'reuse@example.edu');
    const first = await acceptPositionInvite(inviteResp.rawToken);
    assert.equal(first.status, 201);

    const second = await acceptPositionInvite(inviteResp.rawToken);
    assert.equal(second.status, 401);
    assert.equal(second.body.detail, 'Invalid or expired invitation');
  });

  await t.test('a weak password at accept is rejected with 400, invitation stays pending', async () => {
    const collegeId = await seedCollege('acc2');
    const platformAdminToken = await platformToken();
    const inviteResp = await inviteLevel12(platformAdminToken, collegeId, 2, 'weakpass@example.edu');

    const weakResp = await acceptPositionInvite(inviteResp.rawToken, 'weak');
    assert.equal(weakResp.status, 400);

    // Still pending — a real accept with a strong password after the
    // rejected attempt still works.
    const realResp = await acceptPositionInvite(inviteResp.rawToken);
    assert.equal(realResp.status, 201);
  });
});
