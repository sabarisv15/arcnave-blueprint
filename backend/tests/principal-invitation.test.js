'use strict';

// Integration tests for principal invitation — Option B (invite-
// record-now, create-user-later), ported from the deleted Python
// test_principal_invitation.py (git history).
//
// Five things this suite has to prove, not assume:
// 1. Only a platform admin can create an invitation.
// 2. Accepting a valid invitation creates a *correctly tenant-scoped*
//    user — verified via RLS itself, same discipline as
//    test_rls_tenant_isolation.py, not just trusted from the response
//    body looking right.
// 3. Expired and already-accepted tokens are rejected with the same
//    generic message; reuse of an already-accepted token is logged.
// 4. A duplicate username within a tenant is rejected with 409.
// 5. One college's invitation can never result in a user appearing
//    under a different college_id — exercised with two colleges
//    sharing the same requested username, which would collide if
//    invitation A's college_id ever leaked into invitation B's accept
//    flow.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');

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

async function userVisibleUnderTenant(collegeIdForContext, username) {
  const engine = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await engine.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeIdForContext]);
      const result = await client.query('SELECT college_id FROM users WHERE username = $1', [username]);
      await client.query('COMMIT');
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  } finally {
    await engine.end();
  }
}

test('principal invitation', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });

  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUsername = `invplatadmin${suffix}`;
  const adminResult = await adminPool.query(
    `INSERT INTO platform_admins (username, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [adminUsername, `${adminUsername}@example.com`, await security.hashPassword(PLATFORM_PASSWORD)],
  );
  const adminId = adminResult.rows[0].id;

  const createdColleges = [];
  async function seedCollege(label) {
    const cid = `inv${label}${crypto.randomUUID().slice(0, 8)}`;
    await adminPool.query(
      'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $1)',
      [cid],
    );
    createdColleges.push(cid);
    return cid;
  }

  const collegeA = await seedCollege('a');
  const collegeB = await seedCollege('b');

  t.after(async () => {
    await stopServer(server);
    for (const cid of createdColleges) {
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM principal_invitations WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM users WHERE college_id = $1', [cid]);
      // eslint-disable-next-line no-await-in-loop
      await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [cid]);
    }
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

  async function invite(token, collegeId, email) {
    return post(
      baseUrl,
      `/api/v1/platform/colleges/${collegeId}/invite-principal`,
      { authorization: `Bearer ${token}` },
      { email },
    );
  }

  function accept(rawToken, username, password = ACCEPT_PASSWORD) {
    return post(baseUrl, '/api/v1/invitations/accept', {}, { token: rawToken, username, password });
  }

  // --- Invitation creation (platform side) ---

  await t.test('invite-principal requires a platform admin token', async () => {
    const resp = await invite('not-a-real-token', collegeA, 'principal@example.com');
    assert.equal(resp.status, 401);
  });

  await t.test('invite-principal succeeds', async () => {
    const token = await platformToken();
    const resp = await invite(token, collegeA, 'principal@example.com');
    assert.equal(resp.status, 200);
    assert.equal(resp.body.college_id, collegeA);
    assert.equal(resp.body.email, 'principal@example.com');
    assert.ok(resp.body.token);
  });

  await t.test('invite-principal rejects an unknown college', async () => {
    const token = await platformToken();
    const resp = await invite(token, 'no-such-college', 'principal@example.com');
    assert.equal(resp.status, 404);
  });

  // --- Accepting an invitation (tenant side) ---

  await t.test('accept creates a correctly tenant-scoped user', async () => {
    const token = await platformToken();
    const inviteResp = await invite(token, collegeA, 'principal@example.com');
    const rawToken = inviteResp.body.token;

    const username = `accepted${crypto.randomUUID().slice(0, 8)}`;
    const resp = await accept(rawToken, username);
    assert.equal(resp.status, 201);
    assert.equal(resp.body.college_id, collegeA);
    assert.equal(resp.body.username, username);
    assert.equal(resp.body.role, 'principal');

    // The real check: not the response body, RLS itself, exactly as
    // arcnave_app (the runtime role) would see it on any other
    // request.
    const seenUnderA = await userVisibleUnderTenant(collegeA, username);
    assert.ok(seenUnderA);
    const seenUnderB = await userVisibleUnderTenant(collegeB, username);
    assert.equal(seenUnderB, null);

    // And the created account actually works through the ordinary
    // tenant login path.
    const collegeRow = await adminPool.query('SELECT subdomain FROM colleges WHERE college_id = $1', [collegeA]);
    const subdomain = collegeRow.rows[0].subdomain;
    const loginResp = await post(
      baseUrl,
      '/api/v1/auth/login',
      { host: `${subdomain}.arcnave.test` },
      { username, password: ACCEPT_PASSWORD },
    );
    assert.equal(loginResp.status, 200);
  });

  await t.test('an expired token is rejected', async () => {
    const rawToken = `expired-${crypto.randomUUID()}`;
    await adminPool.query(
      `INSERT INTO principal_invitations (college_id, email, token_hash, expires_at)
       VALUES ($1, 'expired@example.com', $2, $3)`,
      [collegeA, security.hashRefreshToken(rawToken), new Date(Date.now() - 60 * 60 * 1000)],
    );

    const resp = await accept(rawToken, `shouldnotexist${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(resp.status, 401);
    assert.equal(resp.body.detail, 'Invalid or expired invitation');
  });

  await t.test('reuse of an already-accepted token is rejected and logged, same message as expired', async () => {
    const token = await platformToken();
    const inviteResp = await invite(token, collegeA, 'principal@example.com');
    const rawToken = inviteResp.body.token;
    const username = `accepted${crypto.randomUUID().slice(0, 8)}`;

    const first = await accept(rawToken, username);
    assert.equal(first.status, 201);

    const originalWarn = console.warn;
    const lines = [];
    console.warn = (text) => {
      lines.push(text);
    };
    let second;
    try {
      second = await accept(rawToken, `different${crypto.randomUUID().slice(0, 8)}`);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(second.status, 401);
    assert.equal(second.body.detail, 'Invalid or expired invitation');
    assert.ok(
      lines.some((text) => JSON.parse(text).message === 'principal_invitation_reuse_detected'),
      'expected console.warn to be called with a principal_invitation_reuse_detected log line',
    );
  });

  await t.test('an unknown token is rejected with the same message', async () => {
    const resp = await accept('not-a-real-invitation-token', `nouser${crypto.randomUUID().slice(0, 8)}`);
    assert.equal(resp.status, 401);
    assert.equal(resp.body.detail, 'Invalid or expired invitation');
  });

  await t.test('a duplicate username within the same tenant is rejected with 409', async () => {
    const token = await platformToken();
    const username = `dupuser${crypto.randomUUID().slice(0, 8)}`;

    const invite1 = await invite(token, collegeA, 'first@example.com');
    const accept1 = await accept(invite1.body.token, username);
    assert.equal(accept1.status, 201);

    const invite2 = await invite(token, collegeA, 'second@example.com');
    const accept2 = await accept(invite2.body.token, username);
    assert.equal(accept2.status, 409);
  });

  // --- Cross-tenant isolation ---

  await t.test(
    'one college\'s invitation can never create a user under a different college_id',
    async () => {
      const token = await platformToken();
      const inviteA = await invite(token, collegeA, 'principal-a@example.com');
      const inviteB = await invite(token, collegeB, 'principal-b@example.com');

      const sharedUsername = `sharedprincipal${crypto.randomUUID().slice(0, 8)}`;

      const respA = await accept(inviteA.body.token, sharedUsername);
      const respB = await accept(inviteB.body.token, sharedUsername);
      assert.equal(respA.status, 201);
      assert.equal(respB.status, 201);
      assert.equal(respA.body.college_id, collegeA);
      assert.equal(respB.body.college_id, collegeB);

      // RLS-scoped proof each row landed under its own college, not
      // the other one.
      const rowUnderA = await userVisibleUnderTenant(collegeA, sharedUsername);
      assert.ok(rowUnderA);
      assert.equal(rowUnderA.college_id, collegeA);

      const rowUnderB = await userVisibleUnderTenant(collegeB, sharedUsername);
      assert.ok(rowUnderB);
      assert.equal(rowUnderB.college_id, collegeB);
    },
  );
});
