'use strict';

// Integration tests for the students API — real HTTP requests against
// a live Postgres, same discipline as configurations.test.js: error
// mapping (StudentValidationError -> 400, StudentRollNoConflictError
// -> 409) is proven against studentService's actual behavior hitting
// a real UNIQUE constraint, not a hand-thrown error standing in for
// one, same rigor as the service slice's live-DB duplicate-roll-no
// test.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'StudentTestPass123!';

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

function get(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'GET', { headers });
}

function post(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'POST', { headers, body });
}

function put(baseUrl, path, headers, body) {
  return requestJson(baseUrl, path, 'PUT', { headers, body });
}

function del(baseUrl, path, headers) {
  return requestJson(baseUrl, path, 'DELETE', { headers });
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

async function seedTenant(adminPool, label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const college = { collegeId: `stu${label}${suffix}`, subdomain: `stutenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  for (const role of ['principal', 'staff']) {
    // eslint-disable-next-line no-await-in-loop
    await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [college.collegeId, `${role}user`, `${role}user@example.com`, passwordHash, role],
    );
  }
  return college;
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM students WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('students', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const adminPool = new Pool({ connectionString: MIGRATION_DATABASE_URL });
  const collegeA = await seedTenant(adminPool, 'a');
  const collegeB = await seedTenant(adminPool, 'b');

  t.after(async () => {
    await stopServer(server);
    await cleanupTenant(adminPool, collegeA);
    await cleanupTenant(adminPool, collegeB);
    await adminPool.end();
  });

  async function login(college, username) {
    const resp = await requestJson(
      baseUrl,
      '/api/v1/auth/login',
      'POST',
      { headers: { host: hostFor(college.subdomain) }, body: { username, password: PASSWORD } },
    );
    assert.equal(resp.status, 200);
    return resp.body.access_token;
  }

  function headersFor(college, token) {
    const headers = { host: hostFor(college.subdomain) };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  // --- Basic mechanics ---

  await t.test('create returns 201 with the created row, snake_case', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R001', full_name: 'Alice Anand', mark_10th: 91.5,
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.roll_no, 'R001');
    assert.equal(resp.body.full_name, 'Alice Anand');
    assert.equal(Number(resp.body.mark_10th), 91.5);
    assert.equal(resp.body.college_id, collegeA.collegeId);
  });

  await t.test('create rejects a missing roll_no with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      full_name: 'No Roll Number',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create rejects a missing full_name with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R002',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create on a duplicate roll_no within the same tenant is a real 409, from a real DB constraint', async () => {
    const token = await login(collegeA, 'principaluser');
    const first = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R010', full_name: 'First Student',
    });
    assert.equal(first.status, 201);

    const dup = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R010', full_name: 'Second Student',
    });
    assert.equal(dup.status, 409);
  });

  await t.test('an aadhaar-shaped field is silently dropped, never stored or echoed back', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R020', full_name: 'No Aadhaar Here', aadhaar_number: '1234-5678-9012',
    });
    assert.equal(resp.status, 201);
    assert.equal('aadhaar_number' in resp.body, false);
  });

  await t.test('get by id returns 200 for an existing student, 404 for an unknown id', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R030', full_name: 'Gettable Student',
    });
    const found = await get(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);

    const missing = await get(baseUrl, `/api/v1/students/${crypto.randomUUID()}`, headersFor(collegeA, token));
    assert.equal(missing.status, 404);
  });

  await t.test('list returns an array and respects limit', async () => {
    const token = await login(collegeA, 'principaluser');
    await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), { roll_no: 'L001', full_name: 'List One' });
    await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), { roll_no: 'L002', full_name: 'List Two' });

    const resp = await get(baseUrl, '/api/v1/students?limit=1', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 1);
  });

  await t.test('update changes a field and returns 200 with the updated row', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R040', full_name: 'Before Update',
    });
    const updated = await put(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, token), {
      full_name: 'After Update',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.full_name, 'After Update');
  });

  await t.test('update against an unknown id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, `/api/v1/students/${crypto.randomUUID()}`, headersFor(collegeA, token), {
      full_name: 'Nobody',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('update onto another student\'s roll_no is a real 409, from a real DB constraint', async () => {
    const token = await login(collegeA, 'principaluser');
    await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), { roll_no: 'R050', full_name: 'Taken RollNo' });
    const second = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R051', full_name: 'Will Collide',
    });

    const resp = await put(baseUrl, `/api/v1/students/${second.body.id}`, headersFor(collegeA, token), {
      roll_no: 'R050',
    });
    assert.equal(resp.status, 409);
  });

  await t.test('delete removes the row and returns 204; a second delete 404s', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'R060', full_name: 'Deletable Student',
    });

    const firstDelete = await del(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(firstDelete.status, 204);

    const getAfter = await get(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(getAfter.status, 404);

    const secondDelete = await del(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(secondDelete.status, 404);
  });

  // --- RBAC ---

  await t.test('create is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'RBAC1', full_name: 'Rbac Test',
    });
    assert.equal(resp.status, 403);
  });

  await t.test('create requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA), {
      roll_no: 'RBAC2', full_name: 'Rbac Test',
    });
    assert.equal(resp.status, 401);
  });

  await t.test('read is allowed for staff, not just principal', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/students', headersFor(collegeA, principalToken), {
      roll_no: 'RBAC3', full_name: 'Readable By Staff',
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, `/api/v1/students/${created.body.id}`, headersFor(collegeA, staffToken));
    assert.equal(resp.status, 200);
  });

  await t.test('read requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/students', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // --- Cross-tenant isolation ---

  await t.test('the same roll_no is independently usable across two tenants', async () => {
    const tokenA = await login(collegeA, 'principaluser');
    const tokenB = await login(collegeB, 'principaluser');

    const respA = await post(baseUrl, '/api/v1/students', headersFor(collegeA, tokenA), {
      roll_no: 'SHARED01', full_name: 'Tenant A Student',
    });
    const respB = await post(baseUrl, '/api/v1/students', headersFor(collegeB, tokenB), {
      roll_no: 'SHARED01', full_name: 'Tenant B Student',
    });
    assert.equal(respA.status, 201);
    assert.equal(respB.status, 201);

    const getFromB = await get(baseUrl, `/api/v1/students/${respA.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(getFromB.status, 404);
  });

  await t.test('a create writes exactly one audit_log row', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/students', headersFor(collegeA, token), {
      roll_no: 'AUDIT01', full_name: 'Audited Student',
    });
    assert.equal(resp.status, 201);

    const row = await adminPool.query(
      `SELECT action, entity, entity_id FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 AND action = 'student_created'`,
      [collegeA.collegeId, resp.body.id],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].entity, 'students');
  });
});
