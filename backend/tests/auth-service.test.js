'use strict';

// Unit tests for AuthService's activateUser (Module 8) — no live
// Postgres: authRepository is stubbed via node:test's built-in mock,
// same technique every other *-service.test.js file uses. Login/
// refresh/revoke are already covered end-to-end at the HTTP level in
// auth.test.js; this file only covers the one function that has no
// route yet.

const test = require('node:test');
const assert = require('node:assert/strict');
const authRepository = require('../src/repositories/authRepository');
const security = require('../src/security');
const authService = require('../src/services/authService');

test('AuthService.activateUser (no DB)', async (t) => {
  await t.test('generates a fresh password, hashes it, and activates via a single repository call', async () => {
    const activateMock = t.mock.method(authRepository, 'activateUser', async (client, userId, fields) => ({
      id: userId,
      college_id: 'c1',
      username: 'jdoe',
      email: 'jdoe@college.edu',
      role: 'staff',
      is_active: true,
      activated_by: fields.activatedBy,
    }));
    t.after(() => activateMock.mock.restore());

    const result = await authService.activateUser({}, 'user-1', { activatedBy: 'principal-1' });

    assert.equal(result.user.id, 'user-1');
    assert.equal(result.user.is_active, true);
    assert.equal(result.user.activated_by, 'principal-1');
    assert.equal(typeof result.plainPassword, 'string');
    assert.ok(result.plainPassword.length >= 12);

    const passedFields = activateMock.mock.calls[0].arguments[2];
    assert.equal(passedFields.activatedBy, 'principal-1');
    // The plaintext password must never be passed to the repository —
    // only its hash. Verified against the real hash, not just "is a
    // different string," so a caller couldn't accidentally pass the
    // plaintext through some other hashed-looking value.
    assert.notEqual(passedFields.passwordHash, result.plainPassword);
    assert.ok(await security.verifyPassword(result.plainPassword, passedFields.passwordHash));
  });

  await t.test('throws UserNotFoundError for a nonexistent userId', async () => {
    const activateMock = t.mock.method(authRepository, 'activateUser', async () => null);
    t.after(() => activateMock.mock.restore());

    await assert.rejects(
      () => authService.activateUser({}, 'missing-user', { activatedBy: 'principal-1' }),
      authService.UserNotFoundError,
    );
  });

  await t.test('two calls generate two different passwords', async () => {
    const activateMock = t.mock.method(authRepository, 'activateUser', async (client, userId) => ({ id: userId, is_active: true }));
    t.after(() => activateMock.mock.restore());

    const first = await authService.activateUser({}, 'user-1', { activatedBy: 'principal-1' });
    const second = await authService.activateUser({}, 'user-1', { activatedBy: 'principal-1' });

    assert.notEqual(first.plainPassword, second.plainPassword);
  });
});
