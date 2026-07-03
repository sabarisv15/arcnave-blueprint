'use strict';

// Ordinary tenant-scoped routes — registered after tenantMiddleware
// in app.js, using req.dbClient/req.collegeId like any other route.
// Not to be confused with middleware/auth.js's AuthMiddleware, which
// is a different thing entirely (decodes a bearer token if present,
// non-enforcing).

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const authService = require('../services/authService');

function createAuthRouter() {
  const router = express.Router();

  router.post('/auth/login', asyncHandler(async (req, res) => {
    if (req.collegeId === null) {
      res.status(400).json({ detail: 'No tenant could be resolved for this request' });
      return;
    }
    const { username, password } = req.body || {};
    try {
      const tokens = await authService.login(req.dbClient, { collegeId: req.collegeId, username, password });
      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
      });
    } catch (err) {
      if (err instanceof authService.AuthError) {
        res.status(401).json({ detail: 'Invalid username or password' });
        return;
      }
      throw err;
    }
  }));

  router.post('/auth/refresh', asyncHandler(async (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    try {
      const tokens = await authService.refresh(req.dbClient, refreshToken);
      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
      });
    } catch (err) {
      // Same client-facing outcome either way — the reuse case is
      // already distinguished server-side via the warning log
      // authService.refresh emits before throwing.
      if (err instanceof authService.RefreshTokenReuseError || err instanceof authService.AuthError) {
        res.status(401).json({ detail: 'Invalid refresh token' });
        return;
      }
      throw err;
    }
  }));

  router.post('/auth/logout', asyncHandler(async (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    await authService.revoke(req.dbClient, refreshToken);
    res.status(204).end();
  }));

  router.post('/auth/password-reset', asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    try {
      authService.requestPasswordReset(email);
    } catch {
      res.status(501).json({ detail: 'Password reset is not implemented yet' });
    }
  }));

  return router;
}

module.exports = createAuthRouter;
