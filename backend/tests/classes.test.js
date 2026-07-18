'use strict';

// Integration tests for the classes API — real HTTP requests against a
// live Postgres, same discipline as staff.test.js: error mapping
// (ClassValidationError -> 400, ClassTimetableStatusError -> 400,
// ClassNameConflictError -> 409, ClassTutorConflictError -> 409,
// ClassTutorNotFoundError -> 404) is proven against academicService's
// actual behavior hitting real DB constraints, not hand-thrown errors
// standing in for them.
//
// Like staff.user_id, classes.tutor_user_id is FK'd to users.id (but
// nullable, unlike staff.user_id) — seedTenant provisions a spare
// already-provisioned account ('subjectuser', role 'staff') per tenant
// to name as a tutor, distinct from 'principaluser' (the actor who
// authenticates and creates/updates classes) and 'staffuser' (used for
// the read-RBAC checks, same as staff.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'ClassesTestPass123!';

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
  const college = { collegeId: `cls${label}${suffix}`, subdomain: `clstenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  // 'subjectuser'/'subjectuser2' stand in for already-provisioned
  // faculty accounts a principal names as a Class Tutor — distinct
  // from 'principaluser' (the actor) and 'staffuser' (read-RBAC only),
  // same split staff.test.js uses.
  for (const username of ['principaluser', 'staffuser', 'subjectuser', 'subjectuser2']) {
    const role = username === 'principaluser' ? 'principal' : 'staff';
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }
  return { ...college, userIds };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('classes', async (t) => {
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
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: '3rd Sem · CS-A', department: 'CSE', semester: '3rd Sem',
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.class_name, '3rd Sem · CS-A');
    assert.equal(resp.body.department, 'CSE');
    assert.equal(resp.body.college_id, collegeA.collegeId);
    assert.equal(resp.body.timetable_status, 'No Tutor');
  });

  await t.test('create rejects a missing class_name with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      department: 'CSE',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create rejects an unknown timetable_status with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Bad Status Class', timetable_status: 'On Hold',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create does not require a tutor_user_id', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'No Tutor Yet Class',
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.tutor_user_id, null);
  });

  await t.test('create on a duplicate class_name within the same tenant is a real 409, from a real DB constraint', async () => {
    const token = await login(collegeA, 'principaluser');
    const first = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Dup Class Name',
    });
    assert.equal(first.status, 201);

    const dup = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Dup Class Name',
    });
    assert.equal(dup.status, 409);
  });

  await t.test('create assigning a tutor already tutoring another class is a real 409', async () => {
    const token = await login(collegeA, 'principaluser');
    const first = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Tutor Conflict Class One', tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(first.status, 201);

    const dup = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Tutor Conflict Class Two', tutor_user_id: collegeA.userIds.subjectuser,
    });
    assert.equal(dup.status, 409);
  });

  await t.test('two classes can independently have no tutor at all', async () => {
    const token = await login(collegeA, 'principaluser');
    const first = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'No Tutor Class One',
    });
    const second = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'No Tutor Class Two',
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
  });

  await t.test('create with a tutor_user_id that does not exist returns 404, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Ghost Tutor Class', tutor_user_id: crypto.randomUUID(),
    });
    assert.equal(resp.status, 404);
  });

  await t.test('an aadhaar-shaped field is silently dropped, never stored or echoed back', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'No Aadhaar Here Class', aadhaar_number: '1234-5678-9012',
    });
    assert.equal(resp.status, 201);
    assert.equal('aadhaar_number' in resp.body, false);
  });

  await t.test('get by id returns 200 for an existing class row, 404 for an unknown id', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Gettable Class',
    });
    const found = await get(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(found.status, 200);
    assert.equal(found.body.id, created.body.id);

    const missing = await get(baseUrl, `/api/v1/classes/${crypto.randomUUID()}`, headersFor(collegeA, token));
    assert.equal(missing.status, 404);
  });

  await t.test('list returns an array and respects limit', async () => {
    const token = await login(collegeA, 'principaluser');
    await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), { class_name: 'List Class One' });
    await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), { class_name: 'List Class Two' });

    const resp = await get(baseUrl, '/api/v1/classes?limit=1', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 1);
  });

  await t.test('update changes a field and returns 200 with the updated row', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Before Update Class',
    });
    const updated = await put(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token), {
      semester: '2nd Sem',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.semester, '2nd Sem');
  });

  await t.test('update rejects a direct attempt to set timetable_status to a workflow-managed value', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Workflow Managed Status Class',
    });
    const resp = await put(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token), {
      timetable_status: 'Approved',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('update against an unknown id returns 404', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, `/api/v1/classes/${crypto.randomUUID()}`, headersFor(collegeA, token), {
      semester: '4th Sem',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('update rejects an unknown timetable_status with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Bad Status Update Class',
    });
    const resp = await put(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token), {
      timetable_status: 'On Hold',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('update onto another class row\'s class_name is a real 409, from a real DB constraint', async () => {
    const token = await login(collegeA, 'principaluser');
    await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), { class_name: 'Taken Class Name' });
    const second = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), { class_name: 'Will Collide Class' });

    const resp = await put(baseUrl, `/api/v1/classes/${second.body.id}`, headersFor(collegeA, token), {
      class_name: 'Taken Class Name',
    });
    assert.equal(resp.status, 409);
  });

  await t.test('update assigning a tutor already tutoring another class is a real 409', async () => {
    const token = await login(collegeA, 'principaluser');
    await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Update Tutor Conflict One', tutor_user_id: collegeA.userIds.subjectuser2,
    });
    const second = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Update Tutor Conflict Two',
    });

    const resp = await put(baseUrl, `/api/v1/classes/${second.body.id}`, headersFor(collegeA, token), {
      tutor_user_id: collegeA.userIds.subjectuser2,
    });
    assert.equal(resp.status, 409);
  });

  await t.test('delete removes the row and returns 204; a second delete 404s', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Deletable Class',
    });

    const firstDelete = await del(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(firstDelete.status, 204);

    const getAfter = await get(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(getAfter.status, 404);

    const secondDelete = await del(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, token));
    assert.equal(secondDelete.status, 404);
  });

  // --- RBAC ---

  await t.test('create is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Rbac Test Class',
    });
    assert.equal(resp.status, 403);
  });

  await t.test('create requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA), {
      class_name: 'Rbac Test Class',
    });
    assert.equal(resp.status, 401);
  });

  // visibilityService scopes 'staff' to SELF_ASSIGNED (their own
  // tutor/faculty-allocated classes only, not every class in the
  // college — the access-leak fix this codebase's own checkpoint
  // documents). tutor_user_id is what makes staffuser "assigned" here.
  await t.test('read is allowed for staff assigned as tutor, not just principal', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Readable By Staff Class',
      tutor_user_id: collegeA.userIds.staffuser,
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, staffToken));
    assert.equal(resp.status, 200);
  });

  await t.test('read is forbidden for staff with no tutor/faculty-allocation assignment to the class', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, principalToken), {
      class_name: 'Unassigned Staff Class',
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await get(baseUrl, `/api/v1/classes/${created.body.id}`, headersFor(collegeA, staffToken));
    assert.equal(resp.status, 403);
  });

  await t.test('read requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/classes', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // --- Cross-tenant isolation ---

  await t.test('the same class_name is independently usable across two tenants', async () => {
    const tokenA = await login(collegeA, 'principaluser');
    const tokenB = await login(collegeB, 'principaluser');

    const respA = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, tokenA), {
      class_name: 'Shared Class Name',
    });
    const respB = await post(baseUrl, '/api/v1/classes', headersFor(collegeB, tokenB), {
      class_name: 'Shared Class Name',
    });
    assert.equal(respA.status, 201);
    assert.equal(respB.status, 201);

    const getFromB = await get(baseUrl, `/api/v1/classes/${respA.body.id}`, headersFor(collegeB, tokenB));
    assert.equal(getFromB.status, 404);
  });

  // --- Audit attribution ---

  await t.test('a create writes exactly one audit_log row, attributed to the actor', async () => {
    const token = await login(collegeA, 'principaluser');

    const resp = await post(baseUrl, '/api/v1/classes', headersFor(collegeA, token), {
      class_name: 'Audited Class',
    });
    assert.equal(resp.status, 201);

    const row = await adminPool.query(
      `SELECT user_id, entity, entity_id FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 AND action = 'class_created'`,
      [collegeA.collegeId, resp.body.id],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].entity, 'classes');
    assert.equal(row.rows[0].user_id, collegeA.userIds.principaluser);
  });
});
