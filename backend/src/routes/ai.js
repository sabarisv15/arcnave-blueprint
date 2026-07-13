'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/rbac');
const aiToolRegistry = require('../services/aiToolRegistry');
const aiService = require('../services/aiService');
const aiProviders = require('../services/aiProviders');
const notificationService = require('../services/notificationService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// Each Policy Gate error gets its own HTTP mapping so a caller (and a
// test) can tell rejections apart, same distinction
// aiToolRegistry.js's own file comment argues for at the error-class
// level: 404 for a name that doesn't exist at all, 409 for a real tool
// this pipeline structurally can't run yet (L2/L3), 403 for every
// actor-vs-tool authorization mismatch.
function mapAiToolError(err, res) {
  if (err instanceof aiToolRegistry.AiToolNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof aiToolRegistry.AiToolLevelNotSupportedError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof aiToolRegistry.AiToolTenantMismatchError
    || err instanceof aiToolRegistry.AiToolRoleNotPermittedError
    || err instanceof aiToolRegistry.AiToolDataClassificationError
    || err instanceof aiToolRegistry.AiToolDepartmentScopeError
  ) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  if (err instanceof aiService.AiServiceValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  // 503, not 500: an unconfigured LLM provider isn't a bug in this
  // request, it's a real, expected environment state (see config.js's
  // own comment on config.nim) — same "no SMTP_HOST means a stub, not
  // a crash" reasoning notificationService.js already established,
  // just surfaced here as an honest error instead of a silent stub
  // because an "ask" genuinely has no answer to give without one.
  if (err instanceof aiProviders.LlmNotConfiguredError) {
    res.status(503).json({ detail: err.message });
    return true;
  }
  // 502: the provider itself is configured and reachable in principle,
  // but this particular call failed upstream — a Bad Gateway, not this
  // server's own fault.
  if (err instanceof aiProviders.LlmRequestError) {
    res.status(502).json({ detail: err.message });
    return true;
  }
  // A college's configured provider genuinely can't do what was asked
  // (e.g. claude has no embeddings endpoint) — a real vendor
  // limitation, not this server's bug and not the caller's mistake.
  if (err instanceof aiProviders.AiProviderCapabilityError) {
    res.status(503).json({ detail: err.message });
    return true;
  }
  // draft_notification/request_notification_send wrap notificationService
  // directly (CLAUDE.md rule 1 — a thin wrapper over a Business
  // Service, no second error-mapping layer of its own) — its domain
  // errors surface here the same way aiToolRegistry's/llmProvider's do,
  // same mapping routes/workflowRequests.js already uses for this
  // exact set of classes.
  if (err instanceof notificationService.NotificationValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof notificationService.NotificationNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (
    err instanceof notificationService.NotificationNoPendingRequestError
    || err instanceof notificationService.NotificationNotApprovedError
  ) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

function createAiRouter() {
  const router = express.Router();

  // requireAuth, not a role gate — the Policy Gate inside
  // aiToolRegistry.js is the real per-tool authorization boundary (same
  // "the service is the gate" reasoning routes/workflowRequests.js's
  // own router comment gives for GET /workflow-requests/pending), not
  // this route. Listing tool names/descriptions carries no
  // classification risk of its own; invoking one is what the gate below
  // actually protects.
  router.get('/ai/tools', requireAuth, asyncHandler(async (req, res) => {
    res.json(aiService.listTools());
  }));

  // An optional body.question turns this into the full Tool Registry
  // -> ... -> LLM pipeline (aiService.askAboutTool); omitting it keeps
  // today's behavior exactly (aiService.invokeTool, stops at the
  // sanitized context blob) — one route, not two, and every existing
  // caller/test that never sends `question` is unaffected.
  router.post('/ai/tools/:name/invoke', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const actor = { userId: req.jwtClaims.sub, role: req.jwtClaims.role, collegeId: req.collegeId };
    const params = (req.body || {}).params || {};
    const question = (req.body || {}).question;
    try {
      const result = question !== undefined
        ? await aiService.askAboutTool(req.dbClient, req.params.name, params, question, { actor })
        : await aiService.invokeTool(req.dbClient, req.params.name, params, { actor });
      res.json(result);
    } catch (err) {
      if (mapAiToolError(err, res)) return;
      throw err;
    }
  }));

  // Tool-selection entry point: body {question}, no toolName — the LLM
  // picks a tool (or none) from aiService.askAgent's own registry list.
  // Same error mapping as /invoke below; the Policy Gate re-validating
  // whatever the LLM picked surfaces through the exact same
  // aiToolRegistry.* error classes (a hallucinated tool name -> 404,
  // same as any caller naming a bad tool would get).
  router.post('/ai/ask', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const actor = { userId: req.jwtClaims.sub, role: req.jwtClaims.role, collegeId: req.collegeId };
    const question = (req.body || {}).question;
    try {
      const result = await aiService.askAgent(req.dbClient, question, { actor });
      res.json(result);
    } catch (err) {
      if (mapAiToolError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createAiRouter;
