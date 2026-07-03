'use strict';

const express = require('express');
const { appPool } = require('./db/pool');

const app = express();

// Minimal liveness + DB connectivity check — same purpose as the
// original Python scaffold's /api/v1/health: prove the app process
// and the arcnave_app connection both work, nothing more. Tenant
// resolution, auth, and everything else Module 0 built is rebuilt in
// later, separate passes.
app.get('/api/v1/health', async (req, res, next) => {
  try {
    await appPool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

module.exports = app;
