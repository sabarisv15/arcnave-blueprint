'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePlatformAdmin } = require('../middleware/platformAuth');
const platformService = require('../services/platformService');
const { platformPool } = require('../db/pool');

function createPlatformRouter() {
  const router = express.Router();

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

  router.post('/colleges/:college_id/invite-principal', requirePlatformAdmin, asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    try {
      const invitation = await platformService.invitePrincipal(platformPool, {
        collegeId: req.params.college_id,
        email,
        createdBy: req.platformClaims.sub,
      });
      res.json({
        college_id: invitation.collegeId,
        email: invitation.email,
        token: invitation.token,
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

  return router;
}

module.exports = createPlatformRouter;
