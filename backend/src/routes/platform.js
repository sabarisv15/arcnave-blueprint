'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePlatformAdmin } = require('../middleware/platformAuth');
const platformService = require('../services/platformService');
const { platformPool } = require('../db/pool');

function createPlatformRouter() {
  const router = express.Router();

  // Deliberately unauthenticated, like /invitations/accept on the
  // tenant side — there is no admin yet to gate this behind. Stays
  // safe because platformService.bootstrapPlatformAdmin can only ever
  // succeed once (a real DB-level atomic guard, not a check-then-insert
  // this route could race); every call after the first is a clean 409.
  router.post('/bootstrap', asyncHandler(async (req, res) => {
    const { username, email, password } = req.body || {};
    try {
      const admin = await platformService.bootstrapPlatformAdmin(platformPool, { username, email, password });
      res.status(201).json({ id: admin.id, username: admin.username, email: admin.email });
    } catch (err) {
      if (err instanceof platformService.PlatformAdminValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      if (err instanceof platformService.PlatformAlreadyBootstrappedError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  // No refresh token issued — checked against the deleted Python
  // version rather than assumed: it didn't build refresh rotation for
  // platform admins either (Module-00-Platform.md's Known
  // Limitations documents this as a deliberate scope cut, not
  // something this pass is re-deciding). Platform admins simply
  // re-authenticate when their access token expires.
  router.post('/auth/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    try {
      const token = await platformService.login(platformPool, { username, password });
      res.json({ access_token: token.accessToken, token_type: token.tokenType });
    } catch (err) {
      if (err instanceof platformService.PlatformAuthError) {
        res.status(401).json({ detail: 'Invalid username or password' });
        return;
      }
      throw err;
    }
  }));

  router.post('/colleges', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { college_id: collegeId, name, subdomain } = req.body || {};
    try {
      const college = await platformService.createCollege(platformPool, {
        collegeId,
        name,
        subdomain,
        createdBy: req.platformClaims.sub,
      });
      res.status(201).json({
        college_id: college.college_id,
        name: college.name,
        subdomain: college.subdomain,
        subscription_status: college.subscription_status,
      });
    } catch (err) {
      if (err instanceof platformService.DuplicateCollegeError) {
        res.status(409).json({ detail: 'college_id or subdomain already exists' });
        return;
      }
      throw err;
    }
  }));

  // No `token` field in the response — this session's own task
  // instruction: an invitation token is delivered only via email
  // (notificationService.sendPrincipalInvitationEmail), never returned
  // in a normal API response.
  router.post('/colleges/:college_id/invite-principal', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    try {
      const invitation = await platformService.invitePrincipal(platformPool, {
        collegeId: req.params.college_id,
        email,
        createdBy: req.platformClaims.sub,
      });
      res.json({
        invitation_id: invitation.invitationId,
        college_id: invitation.collegeId,
        email: invitation.email,
        expires_at: invitation.expiresAt,
      });
    } catch (err) {
      if (err instanceof platformService.CollegeNotFoundError) {
        res.status(404).json({ detail: `No college with college_id ${JSON.stringify(req.params.college_id)}` });
        return;
      }
      throw err;
    }
  }));

  function mapInvitationError(err, res) {
    if (err instanceof platformService.PrincipalInvitationNotFoundError) {
      res.status(404).json({ detail: err.message });
      return true;
    }
    if (err instanceof platformService.PrincipalInvitationNotPendingError) {
      res.status(409).json({ detail: err.message });
      return true;
    }
    return false;
  }

  // Same no-token-in-the-response rule as invite-principal above — a
  // resend rotates the token and emails it, it never echoes it back.
  router.post('/invitations/:invitation_id/resend', requirePlatformAdmin, asyncHandler(async (req, res) => {
    try {
      const invitation = await platformService.resendPrincipalInvitation(platformPool, req.params.invitation_id);
      res.json({
        invitation_id: invitation.invitationId,
        college_id: invitation.collegeId,
        email: invitation.email,
        expires_at: invitation.expiresAt,
      });
    } catch (err) {
      if (mapInvitationError(err, res)) return;
      throw err;
    }
  }));

  router.post('/invitations/:invitation_id/revoke', requirePlatformAdmin, asyncHandler(async (req, res) => {
    try {
      const invitation = await platformService.revokePrincipalInvitation(platformPool, req.params.invitation_id);
      res.json({
        invitation_id: invitation.invitationId,
        college_id: invitation.collegeId,
        email: invitation.email,
        revoked_at: invitation.revokedAt,
      });
    } catch (err) {
      if (mapInvitationError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createPlatformRouter;
