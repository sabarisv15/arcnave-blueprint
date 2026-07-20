'use strict';

// Unit tests for ADR-024 (Session revocation, direct DB check, no
// cache layer yet) — security.createAccessToken's new token_version
// claim, and middleware/sessionRevocation.js's enforcement logic.
// authService/req.dbClient are mocked via node:test's built-in mock,
// same technique as every other *-service.test.js file in this suite
// — no live Postgres needed for these; the real-DB end-to-end proof
// (a password reset actually invalidating a previously-issued token)
// lives in tests/auth.test.js's own password-reset suite plus the
// manual SESSION_REVOCATION_ENFORCED=true verification described in
// this session's own report.

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const security = require('../src/security');
const config = require('../src/config');
const authService = require('../src/services/authService');
const { sessionRevocationMiddleware } = require('../src/middleware/sessionRevocation');

test('security.createAccessToken embeds token_version', async (t) => {
  await t.test('defaults to 0 when no tokenVersion is passed', () => {
    const token = security.createAccessToken({ userId: 'u1', collegeId: 'c1', role: 'staff' });
    const claims = jwt.verify(token, config.jwtSecretKey, { algorithms: [config.jwtAlgorithm] });
    assert.equal(claims.token_version, 0);
  });

  await t.test('carries an explicit tokenVersion through', () => {
    const token = security.createAccessToken({
      userId: 'u1', collegeId: 'c1', role: 'staff', tokenVersion: 7,
    });
    const claims = jwt.verify(token, config.jwtSecretKey, { algorithms: [config.jwtAlgorithm] });
    assert.equal(claims.token_version, 7);
  });
});

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('sessionRevocationMiddleware', async (t) => {
  await t.test('is a no-op when SESSION_REVOCATION_ENFORCED is off (the default) — zero behavior change', async () => {
    const original = config.sessionRevocationEnforced;
    config.sessionRevocationEnforced = false;
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => 0);
    t.after(() => {
      config.sessionRevocationEnforced = original;
      getVersionMock.mock.restore();
    });

    const req = { jwtClaims: { sub: 'u1', type: 'access', token_version: 5 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
    assert.equal(getVersionMock.mock.callCount(), 0, 'must not read the DB at all when the flag is off');
  });

  await t.test('when enforced, lets a request through whose token_version still matches the DB', async () => {
    const original = config.sessionRevocationEnforced;
    config.sessionRevocationEnforced = true;
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => 3);
    t.after(() => {
      config.sessionRevocationEnforced = original;
      getVersionMock.mock.restore();
    });

    const req = { jwtClaims: { sub: 'u1', type: 'access', token_version: 3 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });

  await t.test('when enforced, rejects a token whose embedded version is stale (e.g. after a password reset)', async () => {
    const original = config.sessionRevocationEnforced;
    config.sessionRevocationEnforced = true;
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => 4);
    t.after(() => {
      config.sessionRevocationEnforced = original;
      getVersionMock.mock.restore();
    });

    const req = { jwtClaims: { sub: 'u1', type: 'access', token_version: 3 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  await t.test('when enforced, rejects a token naming a user that no longer exists', async () => {
    const original = config.sessionRevocationEnforced;
    config.sessionRevocationEnforced = true;
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => null);
    t.after(() => {
      config.sessionRevocationEnforced = original;
      getVersionMock.mock.restore();
    });

    const req = { jwtClaims: { sub: 'ghost', type: 'access', token_version: 0 }, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  await t.test('when enforced, passes through a missing/invalid token unchecked — RBAC downstream still 401s it', async () => {
    const original = config.sessionRevocationEnforced;
    config.sessionRevocationEnforced = true;
    const getVersionMock = t.mock.method(authService, 'getCurrentTokenVersion', async () => 0);
    t.after(() => {
      config.sessionRevocationEnforced = original;
      getVersionMock.mock.restore();
    });

    const req = { jwtClaims: null, dbClient: {} };
    const res = fakeRes();
    let nextCalled = false;
    await sessionRevocationMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(getVersionMock.mock.callCount(), 0);
  });
});
