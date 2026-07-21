'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePlatformAdmin } = require('../middleware/platformAuth');
const platformService = require('../services/platformService');
const positionAccountInvitationService = require('../services/positionAccountInvitationService');
const { platformPool } = require('../db/pool');
const { openTenantTransaction } = require('../db/tenantTransaction');

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
    const {
      college_id: collegeId, name, subdomain, level1_position_title: level1PositionTitle,
    } = req.body || {};
    try {
      const college = await platformService.createCollege(platformPool, {
        collegeId,
        name,
        subdomain,
        createdBy: req.platformClaims.sub,
        ipAddress: req.ip,
        level1PositionTitle,
      });
      res.status(201).json({
        college_id: college.college_id,
        name: college.name,
        subdomain: college.subdomain,
        subscription_status: college.subscription_status,
        level1_position_title: college.level1_position_title,
      });
    } catch (err) {
      if (err instanceof platformService.DuplicateCollegeError) {
        res.status(409).json({ detail: 'college_id or subdomain already exists' });
        return;
      }
      throw err;
    }
  }));

  // Organizations screen — UI copy says "Organizations", the
  // underlying model/route stays `colleges` (no rename).
  router.get('/colleges', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { limit, offset, search } = req.query;
    const colleges = await platformService.listColleges(platformPool, {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      search,
    });
    res.json(colleges);
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
        ipAddress: req.ip,
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
      const invitation = await platformService.resendPrincipalInvitation(platformPool, req.params.invitation_id, {
        actorAdminId: req.platformClaims.sub,
        ipAddress: req.ip,
      });
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
      const invitation = await platformService.revokePrincipalInvitation(platformPool, req.params.invitation_id, {
        actorAdminId: req.platformClaims.sub,
        ipAddress: req.ip,
      });
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

  router.get('/invitations', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const {
      limit, offset, status, search,
    } = req.query;
    const invitations = await platformService.listInvitations(platformPool, {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      status,
      search,
    });
    res.json(invitations);
  }));

  router.get('/audit-logs', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const {
      limit, offset, action, actor_admin_id: actorAdminId, from_date: fromDate, to_date: toDate,
    } = req.query;
    const entries = await platformService.listAuditLogs(platformPool, {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      action,
      actorAdminId,
      fromDate,
      toDate,
    });
    res.json(entries);
  }));

  router.get('/settings', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const settings = await platformService.getSettings(platformPool);
    res.json(settings);
  }));

  router.put('/settings', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const {
      platform_name: platformName, support_email: supportEmail, default_timezone: defaultTimezone,
      date_format: dateFormat, items_per_page: itemsPerPage,
    } = req.body || {};
    try {
      const settings = await platformService.updateSettings(platformPool, {
        platformName,
        supportEmail,
        defaultTimezone,
        dateFormat,
        itemsPerPage,
        actorAdminId: req.platformClaims.sub,
        ipAddress: req.ip,
      });
      res.json(settings);
    } catch (err) {
      if (err instanceof platformService.PlatformAdminValidationError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  router.get('/dashboard-summary', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const summary = await platformService.getDashboardSummary(platformPool);
    res.json(summary);
  }));

  // Phase 2 (Position Account Auth), decision 3: Platform Admin ->
  // Level 1/2. Unlike every other route in this file, this one needs
  // to write to TENANT-scoped tables (positions/position_accounts/
  // position_account_invitations) — arcnave_platform (this router's
  // connection) has no GRANT on any of them, by design (ADR-010). This
  // opens its own tenant-scoped transaction against the target college
  // — the same openTenantTransaction/appPool trick
  // routes/positionAccountInvitations.js's (unauthenticated) accept
  // route uses, just from an authenticated-as-Platform-Admin route
  // instead of a tokenized one. actorIsPlatformAdmin: true is what
  // lets assertCanInvite's Level 1/2 rule pass with no capabilities
  // object at all — a Platform Admin has no `users` row to resolve
  // one from.
  router.post('/colleges/:college_id/position-accounts/invite', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { level, email, title } = req.body || {};
    await openTenantTransaction(req, res, req.params.college_id);

    try {
      const { invitation } = await positionAccountInvitationService.inviteToPosition(req.dbClient, {
        collegeId: req.params.college_id,
        level: Number(level),
        title,
        email,
        actorIsPlatformAdmin: true,
        actorCapabilities: null,
        invitedBy: req.platformClaims.sub,
      });
      res.status(201).json({
        invitation_id: invitation.id,
        college_id: invitation.college_id,
        position_id: invitation.position_id,
        email: invitation.email,
        expires_at: invitation.expires_at,
      });
    } catch (err) {
      await req.rollbackTransaction();
      if (err instanceof positionAccountInvitationService.PositionInvitationForbiddenError
        || err instanceof positionAccountInvitationService.PositionInvitationLevelNotSupportedError) {
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

module.exports = createPlatformRouter;
