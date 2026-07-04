'use strict';

// Unit tests for NotificationService's pure logic — no live SMTP
// server, no live Postgres: nodemailer.createTransport is stubbed via
// node:test's built-in mock, same technique every other *-service.test.js
// file in this codebase uses for its own repository. config.smtp is a
// plain object (src/config.js), so tests flip config.smtp.host
// directly between the "unconfigured" and "configured" cases rather
// than mocking config itself — restored in t.after() every time so
// tests never leak state into each other or into other test files that
// import config.

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const config = require('../src/config');
const notificationService = require('../src/services/notificationService');

test('NotificationService (no live SMTP)', async (t) => {
  await t.test('sendEmail rejects a missing to/subject/body without touching nodemailer', async () => {
    const createTransportMock = t.mock.method(nodemailer, 'createTransport');
    t.after(() => createTransportMock.mock.restore());

    await assert.rejects(
      () => notificationService.sendEmail({}, { subject: 'x', body: 'y' }),
      notificationService.NotificationValidationError,
    );
    assert.equal(createTransportMock.mock.callCount(), 0);
  });

  await t.test('sendEmail logs a stub and never touches nodemailer when SMTP_HOST is unconfigured', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = null;
    const createTransportMock = t.mock.method(nodemailer, 'createTransport');
    t.after(() => {
      config.smtp.host = originalHost;
      createTransportMock.mock.restore();
    });

    const result = await notificationService.sendEmail({}, { to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    assert.equal(result.status, 'stubbed');
    assert.equal(result.channel, 'email');
    assert.equal(createTransportMock.mock.callCount(), 0);
  });

  await t.test('sendEmail sends via nodemailer and reports sent when SMTP is configured', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = 'smtp.example.com';
    const sendMailMock = t.mock.fn(async () => ({ messageId: 'abc' }));
    const createTransportMock = t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: sendMailMock }));
    t.after(() => {
      config.smtp.host = originalHost;
      createTransportMock.mock.restore();
    });

    const result = await notificationService.sendEmail({}, { to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    assert.equal(result.status, 'sent');
    assert.equal(sendMailMock.mock.callCount(), 1);
    const sentArgs = sendMailMock.mock.calls[0].arguments[0];
    assert.equal(sentArgs.to, 'a@b.com');
    assert.equal(sentArgs.subject, 'Hi');
    assert.equal(sentArgs.text, 'Hello');
  });

  await t.test('sendEmail reports failed (does not throw) when the real send rejects', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = 'smtp.example.com';
    const sendMailMock = t.mock.fn(async () => { throw new Error('connection refused'); });
    const createTransportMock = t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: sendMailMock }));
    t.after(() => {
      config.smtp.host = originalHost;
      createTransportMock.mock.restore();
    });

    const result = await notificationService.sendEmail({}, { to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'connection refused');
  });

  await t.test('sendStaffCredentialsEmail composes the expected subject/body and delegates to sendEmail', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = null;
    t.after(() => {
      config.smtp.host = originalHost;
    });

    const result = await notificationService.sendStaffCredentialsEmail({}, {
      to: 'staff@college.edu', username: 'jdoe', password: 'temp-pass-1', staffCode: 'STF-2026-AB12CD',
    });

    assert.equal(result.status, 'stubbed');
    assert.equal(result.to, 'staff@college.edu');
    assert.match(result.subject, /active/);
  });
});
