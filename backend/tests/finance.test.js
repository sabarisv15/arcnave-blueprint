'use strict';

// Integration tests for the Finance API (/api/v1/finance/...) — real
// HTTP requests against a live Postgres, same discipline as
// classes.test.js/attendance.test.js: error mapping
// (FeeStructureValidationError/FeePaymentValidationError/
// FeePaymentStatusError -> 400,
// FeeStructureClassNotFoundError/FeePaymentStudentNotFoundError/
// FeePaymentFeeStructureNotFoundError -> 404,
// FeeStructureConflictError/FeePaymentConflictError -> 409) is proven
// against financeService's actual behavior hitting real DB
// constraints, not hand-thrown errors standing in for them.
//
// Module 8 second slice: `status` is no longer a route-writable field
// at all (financeService.js's own header comment) — create/update
// tests that used to assert 400 on an "unknown status" or a real
// status change via PUT are updated below to prove it's now silently
// ignored instead. The real approval gate
// (submitFeeStructureApproval/approveFeeStructure/rejectFeeStructure)
// has no route yet (still service-layer only, per this task's own
// scope), so it isn't exercised here — see finance-service.test.js's
// mocked-workflowService coverage and this task's own live verification
// script instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const createApp = require('../src/app');
const security = require('../src/security');
const { seedPrincipalPosition, cleanupPositionRows } = require('./helpers/positionFixtures');

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PASSWORD = 'FinanceTestPass123!';

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
  const college = { collegeId: `fin${label}${suffix}`, subdomain: `fintenant${label}${suffix}` };
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain) VALUES ($1, $1, $2)',
    [college.collegeId, college.subdomain],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userIds = {};
  for (const [username, role] of [
    ['principaluser', 'principal'],
    ['staffuser', 'staff'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await adminPool.query(
      `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [college.collegeId, username, `${username}@example.com`, passwordHash, role],
    );
    userIds[username] = result.rows[0].id;
  }

  // visibilityService.assertIsPrincipalOfCollege (GET /finance/fee-
  // payments's own real scope check) verifies via
  // staffService.findPrincipal, which JOINs staff to users — a plain
  // users row with role='principal' alone does not satisfy it, same
  // as real principal onboarding always creating both together.
  await adminPool.query(
    `INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Finance API Test Principal')`,
    [college.collegeId, userIds.principaluser],
  );
  await seedPrincipalPosition(adminPool, { collegeId: college.collegeId, userId: userIds.principaluser, passwordHash });

  const cls = await adminPool.query(
    `INSERT INTO classes (college_id, class_name) VALUES ($1, $2) RETURNING id`,
    [college.collegeId, 'Finance API Test Class'],
  );

  const student = await adminPool.query(
    `INSERT INTO students (college_id, roll_no, full_name) VALUES ($1, $2, $3) RETURNING id`,
    [college.collegeId, `FIN-${suffix}`, 'Finance API Test Student'],
  );

  return {
    ...college,
    userIds,
    classId: cls.rows[0].id,
    studentId: student.rows[0].id,
  };
}

async function cleanupTenant(adminPool, college) {
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [college.collegeId]);
  await cleanupPositionRows(adminPool, college.collegeId);
  await adminPool.query('DELETE FROM fee_payments WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM fee_structures WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM students WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM classes WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM refresh_tokens WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [college.collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [college.collegeId]);
}

test('finance', async (t) => {
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

  // --- fee_structures: create ---

  await t.test('principal creates a fee structure: 201 with the created row, snake_case, default status', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Tuition', amount: '45000.00',
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.academic_year, '2025-2026');
    assert.equal(resp.body.class_id, collegeA.classId);
    assert.equal(resp.body.fee_category, 'Tuition');
    assert.equal(resp.body.amount, '45000.00');
    assert.equal(resp.body.status, 'Pending Approval');
    assert.equal(resp.body.college_id, collegeA.collegeId);
  });

  await t.test('create rejects a missing feeCategory with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, amount: '45000.00',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('create silently ignores a caller-supplied status, always Pending Approval', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Hostel', amount: '1000.00', status: 'Approved',
    });
    assert.equal(resp.status, 201);
    assert.equal(resp.body.status, 'Pending Approval');
  });

  await t.test('create on a duplicate (class, year, category) within the same tenant is a real 409, from a real DB constraint', async () => {
    const token = await login(collegeA, 'principaluser');
    const first = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Lab', amount: '2000.00',
    });
    assert.equal(first.status, 201);

    const dup = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Lab', amount: '2500.00',
    });
    assert.equal(dup.status, 409);
  });

  await t.test('create with a nonexistent class_id returns 404, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: crypto.randomUUID(), fee_category: 'Transport', amount: '500.00',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('create requires authentication', async () => {
    const resp = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Sports', amount: '300.00',
    });
    assert.equal(resp.status, 401);
  });

  await t.test('create is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Sports', amount: '300.00',
    });
    assert.equal(resp.status, 403);
  });

  // --- fee_structures: update ---

  await t.test('principal updates a fee structure: 200 with the changed fields, status untouched', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Library', amount: '400.00',
    });
    assert.equal(created.status, 201);

    const updated = await put(baseUrl, `/api/v1/finance/fee-structures/${created.body.id}`, headersFor(collegeA, token), {
      amount: '450.00', status: 'Approved',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.amount, '450.00');
    // status is no longer a route-writable field at all (Module 8
    // second slice) — a caller-supplied value is silently ignored, the
    // row stays at its real, DB-defaulted state.
    assert.equal(updated.body.status, 'Pending Approval');
  });

  await t.test('update silently ignores a status-only body (no recognized fields, no-op)', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Uniform', amount: '600.00',
    });
    const resp = await put(baseUrl, `/api/v1/finance/fee-structures/${created.body.id}`, headersFor(collegeA, token), {
      status: 'Whatever',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.status, 'Pending Approval');
    assert.equal(resp.body.amount, '600.00');
  });

  await t.test('update on a nonexistent id returns 404, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await put(baseUrl, `/api/v1/finance/fee-structures/${crypto.randomUUID()}`, headersFor(collegeA, token), {
      amount: '999.00',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('update is rejected for a non-principal role', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Exam', amount: '250.00',
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await put(baseUrl, `/api/v1/finance/fee-structures/${created.body.id}`, headersFor(collegeA, staffToken), {
      amount: '300.00',
    });
    assert.equal(resp.status, 403);
  });

  // --- fee_structures: list ---

  await t.test('list rejects class_id without academic_year (and vice versa) with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const onlyClass = await get(baseUrl, `/api/v1/finance/fee-structures?class_id=${collegeA.classId}`, headersFor(collegeA, token));
    assert.equal(onlyClass.status, 400);

    const onlyYear = await get(baseUrl, '/api/v1/finance/fee-structures?academic_year=2025-2026', headersFor(collegeA, token));
    assert.equal(onlyYear.status, 400);
  });

  await t.test('list by class_id and academic_year returns this class\'s fee lines for that year', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(
      baseUrl,
      `/api/v1/finance/fee-structures?class_id=${collegeA.classId}&academic_year=2025-2026`,
      headersFor(collegeA, token),
    );
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.ok(resp.body.length >= 1);
    assert.ok(resp.body.every((row) => row.class_id === collegeA.classId));
  });

  await t.test('list with no filters falls back to the plain paginated list', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.ok(resp.body.length >= 1);
  });

  await t.test('list requires authentication', async () => {
    const resp = await get(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  await t.test('fee structures from tenant A are invisible to tenant B\'s plain list', async () => {
    const tokenB = await login(collegeB, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeB, tokenB));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.length, 0);
  });

  // --- fee_payments: mark ---

  await t.test('principal marks a fee payment paid: 200 with the created row, snake_case', async () => {
    const token = await login(collegeA, 'principaluser');
    const feeStructure = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Mark Test Fee', amount: '1200.00',
    });
    assert.equal(feeStructure.status, 201);

    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id, status: 'paid',
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.student_id, collegeA.studentId);
    assert.equal(resp.body.fee_structure_id, feeStructure.body.id);
    assert.equal(resp.body.status, 'paid');
    assert.equal(resp.body.marked_by_user_id, collegeA.userIds.principaluser);
    assert.equal(resp.body.college_id, collegeA.collegeId);
  });

  await t.test('re-marking the same (student, fee_structure) updates the existing payment, not a new one', async () => {
    const token = await login(collegeA, 'principaluser');
    const feeStructure = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Remark Test Fee', amount: '800.00',
    });

    const first = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id, status: 'not_paid',
    });
    assert.equal(first.status, 200);

    // receipt_document_id now has a real FK to documents (added once
    // Module 6 created that table) — a random UUID with no matching
    // row would 23503 instead of the 200 this test expects, so a real
    // row is seeded here rather than a bare crypto.randomUUID().
    const receiptDoc = await adminPool.query(
      `INSERT INTO documents (college_id, student_id, doc_type, file_name, storage_path, mime_type, file_size_bytes, uploaded_by_user_id)
       VALUES ($1, $2, 'fee_receipt', 'receipt.pdf', $3, 'application/pdf', 1024, $4) RETURNING id`,
      [collegeA.collegeId, collegeA.studentId, `${collegeA.collegeId}/receipts/${crypto.randomUUID()}.pdf`, collegeA.userIds.principaluser],
    );

    const second = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id, status: 'paid', receipt_document_id: receiptDoc.rows[0].id,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);
    assert.equal(second.body.status, 'paid');
    assert.notEqual(second.body.receipt_document_id, null);
  });

  await t.test('mark rejects a missing status with 400, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const feeStructure = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Missing Status Fee', amount: '100.00',
    });
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id,
    });
    assert.equal(resp.status, 400);
  });

  await t.test('mark rejects an unknown status with 400', async () => {
    const token = await login(collegeA, 'principaluser');
    const feeStructure = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Unknown Status Fee', amount: '100.00',
    });
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id, status: 'partially_paid',
    });
    assert.equal(resp.status, 400);
  });

  await t.test('mark with a nonexistent student_id returns 404, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const feeStructure = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Ghost Student Fee', amount: '100.00',
    });
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: crypto.randomUUID(), fee_structure_id: feeStructure.body.id, status: 'paid',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('mark with a nonexistent fee_structure_id returns 404, not a 500', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: collegeA.studentId, fee_structure_id: crypto.randomUUID(), status: 'paid',
    });
    assert.equal(resp.status, 404);
  });

  await t.test('mark requires authentication', async () => {
    const feeStructure = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, await login(collegeA, 'principaluser')), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Auth Test Fee', amount: '100.00',
    });
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id, status: 'paid',
    });
    assert.equal(resp.status, 401);
  });

  await t.test('mark is rejected for a non-principal role', async () => {
    const principalToken = await login(collegeA, 'principaluser');
    const feeStructure = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, principalToken), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'RBAC Test Fee', amount: '100.00',
    });

    const staffToken = await login(collegeA, 'staffuser');
    const resp = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, staffToken), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id, status: 'paid',
    });
    assert.equal(resp.status, 403);
  });

  // --- fee_payments: list-by-student ---

  await t.test('list-by-student requires student_id', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token));
    assert.equal(resp.status, 400);
  });

  await t.test('list-by-student returns this student\'s fee marks', async () => {
    const token = await login(collegeA, 'principaluser');
    const resp = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${collegeA.studentId}`, headersFor(collegeA, token));
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.ok(resp.body.length >= 1);
    assert.ok(resp.body.every((row) => row.student_id === collegeA.studentId));
  });

  await t.test('list-by-student requires authentication', async () => {
    const resp = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${collegeA.studentId}`, headersFor(collegeA));
    assert.equal(resp.status, 401);
  });

  // RLS scopes studentRepository.findById to tenant B's own session —
  // collegeA's studentId simply doesn't exist from tenant B's point of
  // view, so financeService.listFeePaymentsForStudent's own
  // FeePaymentStudentNotFoundError fires (mapped to 404), same as
  // "mark with a nonexistent student_id returns 404" above — not a
  // 200 with an empty array, which would leak that *some* row exists
  // somewhere for that id.
  await t.test('a student\'s fee payment from tenant A is invisible to tenant B (RLS via a real student_id collision attempt)', async () => {
    const tokenB = await login(collegeB, 'principaluser');
    const resp = await get(baseUrl, `/api/v1/finance/fee-payments?student_id=${collegeA.studentId}`, headersFor(collegeB, tokenB));
    assert.equal(resp.status, 404);
  });

  // --- Audit attribution ---

  await t.test('create then update writes two audit_log rows, attributed correctly and named correctly', async () => {
    const token = await login(collegeA, 'principaluser');
    const created = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Audit Test Fee', amount: '111.00',
    });
    assert.equal(created.status, 201);

    await put(baseUrl, `/api/v1/finance/fee-structures/${created.body.id}`, headersFor(collegeA, token), {
      amount: '222.00',
    });

    const rows = await adminPool.query(
      `SELECT action, user_id, entity FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 ORDER BY created_at`,
      [collegeA.collegeId, created.body.id],
    );
    assert.equal(rows.rows.length, 2);
    assert.equal(rows.rows[0].action, 'fee_structure_created');
    assert.equal(rows.rows[1].action, 'fee_structure_updated');
    assert.equal(rows.rows[0].entity, 'fee_structures');
    assert.equal(rows.rows[0].user_id, collegeA.userIds.principaluser);
  });

  await t.test('mark then re-mark writes two audit_log rows, attributed correctly and named correctly', async () => {
    const token = await login(collegeA, 'principaluser');
    const feeStructure = await post(baseUrl, '/api/v1/finance/fee-structures', headersFor(collegeA, token), {
      academic_year: '2025-2026', class_id: collegeA.classId, fee_category: 'Audit Payment Fee', amount: '333.00',
    });

    const first = await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id, status: 'not_paid',
    });
    assert.equal(first.status, 200);

    await post(baseUrl, '/api/v1/finance/fee-payments', headersFor(collegeA, token), {
      student_id: collegeA.studentId, fee_structure_id: feeStructure.body.id, status: 'paid',
    });

    const rows = await adminPool.query(
      `SELECT action, user_id, entity FROM audit_log
       WHERE college_id = $1 AND entity_id = $2 ORDER BY created_at`,
      [collegeA.collegeId, first.body.id],
    );
    assert.equal(rows.rows.length, 2);
    assert.equal(rows.rows[0].action, 'fee_payment_marked');
    assert.equal(rows.rows[1].action, 'fee_payment_remarked');
    assert.equal(rows.rows[0].entity, 'fee_payments');
    assert.equal(rows.rows[0].user_id, collegeA.userIds.principaluser);
  });
});
