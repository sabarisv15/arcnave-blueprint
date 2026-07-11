'use strict';

// Ordinary tenant-scoped routes — registered after tenantMiddleware
// in app.js, using req.dbClient/req.collegeId like any other route.
// Not to be confused with middleware/auth.js's AuthMiddleware, which
// is a different thing entirely (decodes a bearer token if present,
// non-enforcing).

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
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

  // Always 204, enumeration-safe — same reasoning login's single
  // generic AuthError uses: whether or not `email` matches a real,
  // active account, the caller sees the identical response either way.
  // authService.requestPasswordReset itself is what actually decides
  // whether to mint a token + send an email at all.
  router.post('/auth/password-reset', asyncHandler(async (req, res) => {
    if (req.collegeId === null) {
      res.status(400).json({ detail: 'No tenant could be resolved for this request' });
      return;
    }
    const { email } = req.body || {};
    await authService.requestPasswordReset(req.dbClient, { collegeId: req.collegeId, email });
    res.status(204).end();
  }));

  router.post('/auth/password-reset/confirm', asyncHandler(async (req, res) => {
    const { token, new_password: newPassword } = req.body || {};
    try {
      await authService.resetPassword(req.dbClient, { token, newPassword });
      res.status(204).end();
    } catch (err) {
      if (err instanceof authService.PasswordResetValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof authService.PasswordResetTokenError) {
        res.status(401).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  // First real RBAC-gated route — same role Module 0's Python version
  // gave it (see git history). Uses requireAuth, not
  // requireRole('staff', 'hod', 'principal'): "return my own identity"
  // isn't a role-gated capability, it holds for any authenticated
  // tenant user regardless of which roles currently exist —
  // deliberately not hardcoding the tenant role list at this call
  // site either, consistent with middleware/rbac.js not hardcoding it
  // in the middleware itself. No DB lookup needed — returns the
  // identity straight from the JWT's already-verified claims.
  router.get('/auth/me', requireAuth, (req, res) => {
    const claims = req.jwtClaims;
    res.json({
      user_id: claims.sub,
      college_id: claims.college_id,
      role: claims.role,
    });
  });

  return router;
}

module.exports = createAuthRouter;
