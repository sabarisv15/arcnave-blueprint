'use strict';

// Module 9 (AI) — Tool Registry + Policy Gate. AI-Governance.md §1/§2:
// "AI Agent -> Tool Registry -> Read/Generate/Workflow Tools ->
// Business Services (never repositories, never storage)". This file
// owns two closely related but genuinely separate jobs, deliberately
// kept in one file because the Policy Gate IS the registry's own
// invocation path, not a bolt-on:
//   1. the registry itself — {name, level, dataClassification,
//      description, handler} entries, each handler a thin wrapper over
//      exactly one Business Service method (CLAUDE.md rule 1). No
//      handler contains its own validation/query construction —
//      AI-Governance.md §2 names this explicitly as the reason the
//      Tool Registry exists at all.
//   2. the Policy Gate — a deterministic, pre-invocation check
//      (tenant match, role, data classification, department scope)
//      run before any handler executes. Never touches prompt/text
//      content — that's aiPromptSafetyLayer.js's job, a strictly
//      separate concern with a different attack surface (content
//      safety vs. authorization).
//
// L1 (Inform), L2 (Generate), and L3 (Act) all have working execution
// paths now — invokeTool rejects any OTHER level value (a typo, a
// future L4 that doesn't exist) with AiToolLevelNotSupportedError, a
// real branch, not a TODO. L3 is the one that needs its own real
// discipline, not a runtime check this file can enforce generically:
// AI-Governance.md §1 — "L3 actions are never executed directly by an
// AI tool. The tool creates a request in WorkflowService... A human
// must approve before the action executes" — means every L3 tool's
// handler MUST be a thin wrapper over a Business Service method that
// itself only ever SUBMITS something for approval (e.g.
// notificationService.submitForApproval, which calls
// workflowService.submitRequest internally), never one that performs
// the actual send/mutation (dispatchApprovedNotification, sendEmail).
// The Policy Gate cannot introspect what a handler's Business Service
// call actually does — this is enforced by registration-time
// discipline/code review, the same way rule 1 ("no handler contains
// its own validation/query construction") is: see request_notification_send
// below for the one real example. The R0-R5 risk ladder and Action
// Manifest are explicitly deferred (see Module-09-AI.md) — this gate
// is the L1/L2/L3 action-level + data-classification check only.
//
// Every Policy Gate rejection also writes an `ai_tool_denied` audit_log
// row (which check failed, for whom) — a security-relevant event
// regardless of outcome, same reasoning `ai_tool_invoked` already
// gets logged for the success path (aiService.js). A tool name that
// doesn't exist at all (AiToolNotFoundError) is NOT logged this way:
// that's rejected before the Policy Gate ever runs against a real
// tool, so there's no actual authorization decision to record, only a
// 404.

const auditLogRepository = require('../repositories/auditLogRepository');

class AiToolNotFoundError extends Error {}
class AiToolLevelNotSupportedError extends Error {}
class AiToolTenantMismatchError extends Error {}
class AiToolRoleNotPermittedError extends Error {}
class AiToolDataClassificationError extends Error {}
class AiToolDepartmentScopeError extends Error {}

// A runtime backstop for the L3 discipline the file-level comment
// above otherwise only documents: an L3 handler returned a result that
// looks like it dispatched/sent something directly instead of only
// submitting for approval. Checked AFTER the handler has already run
// (there is no way to intercept a handler's own internal side effects
// before they happen — this file only ever sees its return value), so
// this cannot undo a bad handler's real-world effect; it exists to
// turn "L3 never dispatches directly" (AI-Governance.md §1 — "always
// required, no exceptions") into a checked invariant that fails loudly
// and gets audit-logged, rather than a convention a future handler
// could silently violate unnoticed.
class AiToolL3BypassError extends Error {}

// Real, generic execution paths for all three authority levels. See
// file-level comment for the discipline L3 handlers must follow (this
// list being non-empty for L3 is not itself a safety guarantee — the
// handler's own Business Service call is).
const SUPPORTED_LEVELS = ['L1', 'L2', 'L3'];

// Conservative default, not sourced from BusinessRules.md (which does
// not yet define an AI-actor/data-classification matrix) — revisit via
// ADR alongside the R0-R5 risk ladder when the first tool needing
// Confidential/Restricted access for a wider role is proposed. Every
// real login role in this codebase (principal, college_admin, hod,
// staff — see routes/*.js's requireRole call sites) gets Internal;
// Confidential (parent phone, marks) is withheld from plain staff;
// Restricted (fee details, staff salary) is withheld from everyone
// until a real tool needs it.
const ROLE_CLASSIFICATION_ACCESS = {
  principal: ['Internal', 'Confidential', 'Restricted'],
  college_admin: ['Internal', 'Confidential'],
  hod: ['Internal', 'Confidential'],
  staff: ['Internal'],
};

const registry = new Map();

// A tool with no declared `params` takes no meaningful caller input
// (get_college_profile is the only example today — it reads
// actor.collegeId, never a caller-supplied argument) — an empty,
// closed object schema, not an open/permissive one, so a
// function-calling LLM isn't invited to invent arguments a tool
// doesn't use.
const DEFAULT_PARAMS_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

function registerTool(tool) {
  if (!tool || !tool.name || !tool.level || !tool.dataClassification || typeof tool.handler !== 'function') {
    throw new Error('tool must have {name, level, dataClassification, handler}');
  }
  registry.set(tool.name, tool);
}

function getTool(name) {
  return registry.get(name) || null;
}

// `params` is a JSON-Schema-shaped description of the tool's caller-
// supplied arguments — exposed so aiService.askAgent can hand the
// whole list to llmProvider.completeWithTools as a function-calling
// schema (name + description + params, this slice's own build brief).
// Never the tool's internal logic, just its own declared input shape.
function listTools() {
  return Array.from(registry.values()).map(({ name, level, dataClassification, description, params }) => ({
    name,
    level,
    dataClassification,
    description,
    params: params || DEFAULT_PARAMS_SCHEMA,
  }));
}

// The Policy Gate. Four independent checks, each its own error class —
// a caller needs to tell a wrong-role rejection apart from a wrong-
// classification rejection apart from a cross-tenant attempt; a single
// generic "denied" would hide which of four unrelated invariants
// actually failed, both from a caller and from test coverage (this
// slice's own verification brief asks for exactly this distinction).
function assertPolicyAllows(tool, actor, params) {
  if (!SUPPORTED_LEVELS.includes(tool.level)) {
    throw new AiToolLevelNotSupportedError(
      `tool ${JSON.stringify(tool.name)} is level ${JSON.stringify(tool.level)}, which is not a supported `
      + `authority level (expected one of ${JSON.stringify(SUPPORTED_LEVELS)} — AI-Governance.md §1)`,
    );
  }

  if (params && params.collegeId !== undefined && params.collegeId !== actor.collegeId) {
    throw new AiToolTenantMismatchError(
      `actor's tenant ${JSON.stringify(actor.collegeId)} does not match requested collegeId ${JSON.stringify(params.collegeId)}`,
    );
  }

  const allowedRoles = tool.allowedRoles || [];
  if (!allowedRoles.includes(actor.role)) {
    throw new AiToolRoleNotPermittedError(
      `role ${JSON.stringify(actor.role)} is not permitted to invoke tool ${JSON.stringify(tool.name)}`,
    );
  }

  const permittedClassifications = ROLE_CLASSIFICATION_ACCESS[actor.role] || [];
  if (!permittedClassifications.includes(tool.dataClassification)) {
    throw new AiToolDataClassificationError(
      `role ${JSON.stringify(actor.role)} is not permitted to access `
      + `${JSON.stringify(tool.dataClassification)} data (tool ${JSON.stringify(tool.name)})`,
    );
  }

  if (tool.departmentScoped) {
    const departmentId = params && params.departmentId;
    if (!departmentId || departmentId !== actor.departmentId) {
      throw new AiToolDepartmentScopeError(
        `actor's department ${JSON.stringify(actor.departmentId)} does not match requested `
        + `departmentId ${JSON.stringify(departmentId)} (tool ${JSON.stringify(tool.name)})`,
      );
    }
  }
}

// Maps a Policy Gate error to a short, stable reason code for
// ai_tool_denied's metadata — the error message itself is meant for a
// human reading the exception, this is meant for querying/grouping
// audit_log rows by which check failed.
function describePolicyFailureReason(err) {
  if (err instanceof AiToolLevelNotSupportedError) return 'level_not_supported';
  if (err instanceof AiToolTenantMismatchError) return 'tenant';
  if (err instanceof AiToolRoleNotPermittedError) return 'role';
  if (err instanceof AiToolDataClassificationError) return 'classification';
  if (err instanceof AiToolDepartmentScopeError) return 'department_scope';
  if (err instanceof AiToolL3BypassError) return 'l3_bypass';
  return 'unknown';
}

// A result that looks like a direct dispatch/send rather than a
// submission — checked generically (any status string a future
// ledger-backed entity might use for its own terminal "already sent"
// state), not hardcoded to notifications alone, since a future L3 tool
// may wrap a different Business Service entirely.
const L3_BYPASS_STATUSES = ['Dispatched', 'sent'];

// The one thing every real L3 handler's result MUST look like: a
// submission, not a completed action. `workflow_request_id` present
// (truthy) proves a real workflow_requests row now governs whatever
// this handler touched — the one structural fact a "submit for
// approval" call (e.g. notificationService.submitForApproval) always
// leaves behind and a direct-action call (dispatchApprovedNotification/
// sendEmail) never does. `status` not already a terminal/dispatched
// value is the second, independent signal — belt and suspenders,
// since a hypothetical bad handler could fabricate a workflow_request_id
// without actually going through WorkflowService.
function assertL3ResultNotBypassed(tool, result) {
  if (!result || !result.workflow_request_id) {
    throw new AiToolL3BypassError(
      `L3 tool ${JSON.stringify(tool.name)}'s handler returned a result with no workflow_request_id — `
      + 'an L3 handler must only ever submit something for approval (AI-Governance.md §1), never act directly',
    );
  }
  if (L3_BYPASS_STATUSES.includes(result.status)) {
    throw new AiToolL3BypassError(
      `L3 tool ${JSON.stringify(tool.name)}'s handler returned status ${JSON.stringify(result.status)}, which looks `
      + 'like a completed dispatch/send — an L3 handler must only ever submit for approval (AI-Governance.md §1), '
      + 'never dispatch/send directly',
    );
  }
}

// The one real entry point aiService.js calls. Not exposed as
// "getTool, then call the handler yourself" — every invocation must
// pass through assertPolicyAllows, so there is exactly one path into
// any handler, never a bypass.
async function invokeTool(name, { client, actor, params } = {}) {
  const tool = getTool(name);
  if (tool === null) {
    throw new AiToolNotFoundError(`no AI tool named ${JSON.stringify(name)} is registered`);
  }
  try {
    assertPolicyAllows(tool, actor, params || {});
  } catch (err) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: actor.collegeId,
      userId: actor.userId,
      action: 'ai_tool_denied',
      entity: 'ai_tools',
      entityId: null,
      metadata: { toolName: name, reason: describePolicyFailureReason(err) },
    });
    throw err;
  }

  const result = await tool.handler(client, params || {}, actor);

  // The runtime backstop — see AiToolL3BypassError's own comment.
  // Only meaningful for L3 (submission-only) tools; L1/L2 handlers are
  // never expected to look like a "submission," so this check would be
  // actively wrong to apply to them.
  if (tool.level === 'L3') {
    try {
      assertL3ResultNotBypassed(tool, result);
    } catch (err) {
      await auditLogRepository.createAuditLogEntry(client, {
        collegeId: actor.collegeId,
        userId: actor.userId,
        action: 'ai_tool_denied',
        entity: 'ai_tools',
        entityId: null,
        metadata: { toolName: name, reason: describePolicyFailureReason(err) },
      });
      throw err;
    }
  }

  return result;
}

// --- Real tool #1 ----------------------------------------------------
// get_college_profile: L1/Inform (a pure read, no external effect),
// Internal classification (name/affiliating_university/
// year_established/address — none of AI-Governance.md §4's
// Confidential/Restricted rows). Thin wrapper over
// collegeProfileService.getProfile (CLAUDE.md rule 1 — the Business
// Service, never collegeProfileRepository directly). Scoped to
// principal/college_admin/hod, not plain staff — profile-level
// college metadata isn't every staff member's concern, same
// conservative-placeholder reasoning routes/collegeProfile.js's own
// college_admin-only RBAC gate already uses for the human-facing route.
const collegeProfileService = require('./collegeProfileService');

registerTool({
  name: 'get_college_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads the acting user's own college profile (name, affiliating university, year established, address).",
  allowedRoles: ['principal', 'college_admin', 'hod'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => collegeProfileService.getProfile(client, actor.collegeId),
});

// --- Real tools #2/#3 — the flagship "AI drafts, human approves, then
// it sends" path -------------------------------------------------------
// Both wrap notificationService (Module 8's ledger extension) — the
// same Business Service a human-initiated notification would use,
// never a second, AI-only code path (AI-Governance.md §2's whole
// point). `Confidential` classification for both: a notification's
// `to_address` is recipient contact info, the same category
// AI-Governance.md §4's table gives "Parent phone" — not automatically
// visible to plain `staff`, same `allowedRoles` scoping
// get_college_profile already uses.
const notificationService = require('./notificationService');

// draft_notification: L2/Generate — produces a row (the Draft), no
// external effect, no approval needed to draft (AI-Governance.md §1's
// table: L2 "None — but produces no external effect"). Thin wrapper
// over notificationService.draftNotification; origin is hardcoded
// 'ai', never caller-supplied — this tool exists specifically because
// the AI is the one drafting, so there is no ambiguity to leave open
// the way draftNotification's own default ('human') covers for a
// human-facing caller.
registerTool({
  name: 'draft_notification',
  level: 'L2',
  dataClassification: 'Confidential',
  description: 'Drafts an outbound notification (channel, recipient, subject, body) for later human approval and sending. '
    + 'Never sends anything by itself — the draft must be submitted via request_notification_send and approved by a human first.',
  allowedRoles: ['principal', 'college_admin', 'hod'],
  params: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: "Delivery channel, e.g. 'email' (the only real channel today)." },
      toAddress: { type: 'string', description: "Recipient's email address (or phone number for a future channel)." },
      subject: { type: 'string', description: 'Email subject line. Omit for a channel with no subject line.' },
      body: { type: 'string', description: 'The message content to send.' },
    },
    required: ['channel', 'toAddress', 'body'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => notificationService.draftNotification(
    client,
    { collegeId: actor.collegeId, channel: params.channel, toAddress: params.toAddress, subject: params.subject, body: params.body, origin: 'ai' },
    { actorUserId: actor.userId },
  ),
});

// request_notification_send: L3/Act — AI-Governance.md §1: "always
// required, no exceptions." This handler's ONLY Business Service call
// is notificationService.submitForApproval, which itself only ever
// calls workflowService.submitRequest — it structurally cannot send
// anything; there is no code path from this handler to
// notificationService.dispatchApprovedNotification/sendEmail. Sending
// only ever happens later, when a human approves via the existing
// POST /workflow-requests/:id/approve route (routes/workflowRequests.js's
// entity_type === 'notification' case), completely outside this
// handler's own call stack. requested_by_user_id is the real
// authenticated actor (actor.userId) — AI-Governance.md's own point
// that every AI action still ties back to the real user whose session
// triggered it, origin distinguishes who drafted the content, not
// whether a user was present.
registerTool({
  name: 'request_notification_send',
  level: 'L3',
  dataClassification: 'Confidential',
  description: 'Submits a previously drafted notification (from draft_notification) for human approval. '
    + 'Does NOT send it — a human must approve via the workflow approvals screen before anything is dispatched.',
  allowedRoles: ['principal', 'college_admin', 'hod'],
  params: {
    type: 'object',
    properties: {
      notificationId: { type: 'string', description: 'The id of a previously drafted notification (from draft_notification) to submit for approval.' },
    },
    required: ['notificationId'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => notificationService.submitForApproval(
    client,
    params.notificationId,
    { requestedByUserId: actor.userId },
  ),
});

module.exports = {
  AiToolNotFoundError,
  AiToolLevelNotSupportedError,
  AiToolTenantMismatchError,
  AiToolRoleNotPermittedError,
  AiToolDataClassificationError,
  AiToolDepartmentScopeError,
  AiToolL3BypassError,
  registerTool,
  getTool,
  listTools,
  invokeTool,
};
