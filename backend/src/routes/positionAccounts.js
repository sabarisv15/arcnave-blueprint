'use strict';

// Ordinary tenant-scoped routes, registered after tenantMiddleware —
// mirrors routes/auth.js's login/refresh/logout shape exactly, just
// against positionAccountAuthService instead of authService. The
// Level 3 (HOD) invite route lives here too: it's an ordinary
// requireAuth'd tenant route (the inviting actor is a Level 2
// position-holder acting from their PERSONAL login, per the plan's
// decision 4) — not to be confused with routes/positionAccountInvitations.js's
// accept route, which (like routes/invitations.js) must run
// unauthenticated, before tenantMiddleware.

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const positionAccountAuthService = require('../services/positionAccountAuthService');
const positionAccountInvitationService = require('../services/positionAccountInvitationService');

function createPositionAccountsRouter() {
  const router = express.Router();

  router.post('/position-accounts/login', asyncHandler(async (req, res) => {
    if (req.collegeId === null) {
      res.status(400).json({ detail: 'No tenant could be resolved for this request' });
      return;
    }
    const { official_email: officialEmail, password } = req.body || {};
    try {
      const result = await positionAccountAuthService.login(req.dbClient, {
        collegeId: req.collegeId, officialEmail, password,
      });
      res.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: result.tokenType,
      });
    } catch (err) {
      if (err instanceof positionAccountAuthService.PositionAuthError) {
        res.status(401).json({ detail: 'Invalid official email or password' });
        return;
      }
      throw err;
    }
  }));

  router.post('/position-accounts/refresh', asyncHandler(async (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    try {
      const tokens = await positionAccountAuthService.refresh(req.dbClient, refreshToken);
      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: tokens.tokenType,
      });
    } catch (err) {
      // Same client-facing outcome either way — auth.js's own
      // /auth/refresh follows this exact reasoning for the personal-
      // login equivalent.
      if (err instanceof positionAccountAuthService.PositionRefreshTokenReuseError
        || err instanceof positionAccountAuthService.PositionAuthError) {
        res.status(401).json({ detail: 'Invalid refresh token' });
        return;
      }
      throw err;
    }
  }));

  router.post('/position-accounts/logout', asyncHandler(async (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    await positionAccountAuthService.revoke(req.dbClient, refreshToken);
    res.status(204).end();
  }));

  // Level 3 (HOD) invite — the actor is a Level 2 position-holder
  // acting from their PERSONAL login (req.jwtClaims.sub is a userId,
  // req.capabilities is their resolveCapabilities result), never a
  // Position Account session inviting another. Level 1/2 invites are
  // Platform-Admin-only and live on the platform router instead — see
  // routes/platform.js.
  router.post('/departments/:departmentId/position-accounts/invite', requireAuth, asyncHandler(async (req, res) => {
    const { email, title } = req.body || {};
    try {
      const { invitation } = await positionAccountInvitationService.inviteToPosition(req.dbClient, {
        collegeId: req.collegeId,
        level: 3,
        departmentId: req.params.departmentId,
        title,
        email,
        actorIsPlatformAdmin: false,
        actorCapabilities: req.capabilities,
        invitedBy: req.jwtClaims.sub,
      });
      res.status(201).json({
        invitation_id: invitation.id,
        college_id: invitation.college_id,
        position_id: invitation.position_id,
        email: invitation.email,
        expires_at: invitation.expires_at,
      });
    } catch (err) {
      if (err instanceof positionAccountInvitationService.PositionInvitationForbiddenError) {
        res.status(403).json({ detail: err.message });
        return;
      }
      if (err instanceof positionAccountInvitationService.PositionInvitationValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof positionAccountInvitationService.PositionAccountAlreadyProvisionedError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  return router;
}

module.exports = createPositionAccountsRouter;
