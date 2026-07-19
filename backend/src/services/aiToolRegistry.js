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
// below for the one real example.
//
// R0-R5 risk ladder + Action Manifest (this session's own task):
// AI-Governance.md names L1/L2/L3 (action level) and Internal/
// Confidential/Restricted (data classification) as its two axes, but
// never actually specifies an "R0-R5" ladder anywhere in the doc — this
// is this slice's own, explicitly-flagged interpretation, not a spec
// transcription. RISK_MATRIX below derives a tool's risk level
// deterministically from its own already-declared level +
// dataClassification (never a third, independently-set field that
// could drift from those two), monotonically non-decreasing in both
// axes, capped at R5 for the single most dangerous combination (L3 +
// Restricted). The ladder currently informs the Action Manifest
// (below) — it makes an AI action's real risk visible to the human
// approver at approval time — but it does NOT add a second, automated
// hard-block beyond AI-Governance.md's existing "L3 always requires
// human approval, no exceptions" rule. A real escalation policy (e.g.
// "R5 requires two independent approvers") is a follow-up, deliberately
// not invented here: `request_notification_send` (R4: L3+Confidential)
// is the only real L3 tool that exists today, and no R5 tool exists
// yet to design that policy against without guessing.
//
// The Action Manifest is a structured record of what an L3 tool call
// actually is — toolName, actionLevel, dataClassification, riskLevel,
// the actor who invoked it, and the params it was called with —
// attached to the workflow_requests row it creates (via
// workflowService.submitRequest's new optional actionManifest
// parameter, migration 1754100000000) so the human approver can see
// what they're actually approving, not just an entity_type/entity_id
// pair. Built fresh per call inside invokeTool (buildActionManifest
// below), passed to the handler as a 4th argument — L1/L2 handlers
// never see it (JS silently ignores an extra argument a function
// doesn't declare), only an L3 handler that explicitly accepts and
// forwards it (see request_notification_send) actually attaches one.
// Not an LLM-generated summary — every field is either a hard fact
// this file already computes (level/classification/risk) or the
// caller-supplied params/actor identity, never free text a model wrote.
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
const aiClassificationAccess = require('./aiClassificationAccess');

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

const registry = new Map();

// A tool with no declared `params` takes no meaningful caller input
// (get_college_profile is the only example today — it reads
// actor.collegeId, never a caller-supplied argument) — an empty,
// closed object schema, not an open/permissive one, so a
// function-calling LLM isn't invited to invent arguments a tool
// doesn't use.
const DEFAULT_PARAMS_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

// R0-R5 risk ladder — see the file-level comment for what this is and
// (importantly) is not. Deliberately a plain lookup table, not a
// formula: a formula invites someone to "simplify" it in a way that
// silently changes a risk level nobody reviewed, where an explicit
// table makes every one of the 9 real (level, classification)
// combinations a reviewable, individual decision. Monotonic by
// construction — reading down any column or across any row, the
// number never decreases.
const RISK_MATRIX = {
  L1: { Internal: 0, Confidential: 1, Restricted: 1 },
  L2: { Internal: 2, Confidential: 2, Restricted: 3 },
  L3: { Internal: 3, Confidential: 4, Restricted: 5 },
};

function computeRiskLevel(level, dataClassification) {
  const row = RISK_MATRIX[level];
  const risk = row && row[dataClassification];
  return typeof risk === 'number' ? risk : null;
}

function registerTool(tool) {
  if (!tool || !tool.name || !tool.level || !tool.dataClassification || typeof tool.handler !== 'function') {
    throw new Error('tool must have {name, level, dataClassification, handler}');
  }
  // Computed at registration time from the tool's own declared level +
  // dataClassification, never a third field a registration could set
  // independently (and so never a field that could disagree with
  // them) — see RISK_MATRIX's own comment.
  registry.set(tool.name, { ...tool, riskLevel: computeRiskLevel(tool.level, tool.dataClassification) });
}

function getTool(name) {
  return registry.get(name) || null;
}

// The Action Manifest (see file-level comment) — a plain, fully-
// deterministic object, never LLM-generated text. Only called for L3
// tools (invokeTool below) since AI-Governance.md's approval
// requirement — the whole reason a manifest needs to travel with a
// request at all — only applies to L3; an L1/L2 call has no approval
// step for a human to inspect this against.
function buildActionManifest(tool, actor, params) {
  return {
    toolName: tool.name,
    actionLevel: tool.level,
    dataClassification: tool.dataClassification,
    riskLevel: tool.riskLevel,
    actorUserId: actor.userId,
    actorRole: actor.role,
    collegeId: actor.collegeId,
    params: params || {},
    requestedAt: new Date().toISOString(),
    manifestVersion: 1,
  };
}

// `params` is a JSON-Schema-shaped description of the tool's caller-
// supplied arguments — exposed so aiService.askAgent can hand the
// whole list to llmProvider.completeWithTools as a function-calling
// schema (name + description + params, this slice's own build brief).
// riskLevel is exposed alongside for the same reason — a caller (or a
// future dashboard) can see a tool's real risk without recomputing
// RISK_MATRIX itself. Never the tool's internal logic, just its own
// declared input shape + derived risk.
function listTools() {
  return Array.from(registry.values()).map(({
    name, level, dataClassification, riskLevel, description, params,
  }) => ({
    name,
    level,
    dataClassification,
    riskLevel,
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

  const permittedClassifications = aiClassificationAccess.permittedClassifications(actor.role);
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

  // Action Manifest — built only for L3 (see buildActionManifest's own
  // comment for why L1/L2 don't get one) and passed as a 4th handler
  // argument. Every existing L1/L2 handler's signature is (client,
  // params, actor) — JS silently ignores an argument a function
  // doesn't declare, so this is not a breaking change to any of them;
  // only a handler that explicitly adds a 4th parameter (see
  // request_notification_send below) actually receives and forwards it.
  const manifest = tool.level === 'L3' ? buildActionManifest(tool, actor, params || {}) : undefined;
  const result = await tool.handler(client, params || {}, actor, manifest);

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
// principal/hod, not plain staff — profile-level college metadata
// isn't every staff member's concern, same conservative-placeholder
// reasoning routes/collegeProfile.js's own principal-only RBAC gate
// already uses for the human-facing route (moved from college_admin —
// see that file's comment).
const collegeProfileService = require('./collegeProfileService');

registerTool({
  name: 'get_college_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads the acting user's own college profile (name, affiliating university, year established, address).",
  allowedRoles: ['principal', 'hod'],
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
  allowedRoles: ['principal', 'hod'],
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
//
// The 4th handler argument (manifest) is this tool's Action Manifest —
// built by invokeTool above only because this tool is L3 — forwarded
// straight through to notificationService.submitForApproval, which
// forwards it again to workflowService.submitRequest, which persists it
// on the workflow_requests row this call creates. The human approving
// this request (routes/workflowRequests.js) can now see the tool name,
// risk level, and exact params an AI action submitted, not just
// "notification, entity id X."
registerTool({
  name: 'request_notification_send',
  level: 'L3',
  dataClassification: 'Confidential',
  description: 'Submits a previously drafted notification (from draft_notification) for human approval. '
    + 'Does NOT send it — a human must approve via the workflow approvals screen before anything is dispatched.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      notificationId: { type: 'string', description: 'The id of a previously drafted notification (from draft_notification) to submit for approval.' },
    },
    required: ['notificationId'],
    additionalProperties: false,
  },
  handler: (client, params, actor, manifest) => notificationService.submitForApproval(
    client,
    params.notificationId,
    { requestedByUserId: actor.userId, actionManifest: manifest },
  ),
});

// --- Real tool #4 — RAG ------------------------------------------------
// search_documents: L1/Inform (a pure read, no external effect).
// Registered at Internal — the tool's own declared CEILING for the
// Policy Gate's single tool-level check, deliberately the lowest
// classification so every real role may call it at all — the REAL,
// finer-grained restriction (which individual chunks a given role may
// actually see back) is row-level, computed inside
// documentSearchService.searchDocuments via aiClassificationAccess.
// permittedClassifications(actor.role), never in this tool entry
// itself (CLAUDE.md rule 1: no business logic in the wrapper). This
// mirrors AI-Governance.md §4's own point that action level and data
// classification are independent checks — here that independence runs
// one layer deeper, down to individual rows within one tool call.
const documentSearchService = require('./documentSearchService');

registerTool({
  name: 'search_documents',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Semantic search over the college's own uploaded documents (certificates, templates, etc.) — "
    + 'returns the most relevant text chunks for a natural-language query, scoped to what the acting role is '
    + 'permitted to see.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A natural-language question or search phrase.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => documentSearchService.searchDocuments(client, { query: params.query }, actor),
});

// --- Real tool #5 — AI attendance assistant ----------------------------
// mark_attendance_nl: BusinessRules.md AI Attendance Management. AI-
// Governance.md §1 lists "modify attendance" as its own L3 example
// ("AI, please mark Sunil absent") — but that example is the AI
// deciding/initiating a change on someone else's behalf. This tool is
// structurally the other case §1 already carves out for Send Alert: a
// human's own real-time command about their own already-eligible
// action, with the AI acting only as a natural-language front end, not
// an independent decision-maker. It can never do anything the acting
// user couldn't already do by calling POST /api/v1/attendance directly
// — attendanceService.markAttendanceByRollNumbers's own call into
// markAttendance re-verifies the exact same tutor/HOD/scheduled-staff/
// substitute eligibility check (assertCanMark) that route already
// enforces; the tool grants no authority the human didn't already have.
// Registered L1 (not L3) for that reason — see AI-Governance.md §1's
// own updated note for the explicit carve-out, added in this same
// slice. No WorkflowService submission here, matching Send Alert's own
// "direct, human-triggered action" precedent, not a new exception
// invented ad hoc.
const attendanceService = require('./attendanceService');

registerTool({
  name: 'mark_attendance_nl',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Marks attendance for the session the acting faculty member is currently teaching, from a list of '
    + 'absent roll numbers (e.g. "mark roll numbers 35, 67, and 25 absent") — every other enrolled student in that '
    + "session is marked Present. Resolves the current session from the acting user's own approved timetable "
    + 'allocation or substitute assignment; fails if they have no active session right now.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      absent_roll_numbers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Roll numbers to mark Absent. Every other student enrolled in the resolved class is marked Present.',
      },
    },
    required: ['absent_roll_numbers'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => attendanceService.markAttendanceByRollNumbers(
    client,
    { absentRollNumbers: params.absent_roll_numbers },
    { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
  ),
});

// --- Real tool #6 — Academic Calendar read (task #20) -------------------
// list_calendar_events: BusinessRules.md Platform administration,
// Academic Calendar — "AI can answer calendar questions but never
// creates or edits an event without authorization." L1/Inform, a pure
// read with no external effect; Internal classification (semester
// dates/holidays/exam windows carry no student-identifying or contact
// data, unlike AI-Governance.md §4's Confidential/Restricted rows).
// Thin wrapper over calendarService.listEvents, which itself has no
// write path at all — the "never creates or edits" half of the rule is
// satisfied structurally, not by a runtime check this tool would have
// to get right. Open to every tenant role, same as the human-facing
// GET /calendar-events route (one shared institutional calendar, not
// scoped per role).
const calendarService = require('./calendarService');

registerTool({
  name: 'list_calendar_events',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Lists academic calendar events (semester dates, holidays, exams, and other institution-defined '
    + 'events) for the acting college, optionally within a date range. Read-only — never creates or edits an event.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      from_date: { type: 'string', description: "Optional ISO date (YYYY-MM-DD) — only events starting on or after this date." },
      to_date: { type: 'string', description: "Optional ISO date (YYYY-MM-DD) — only events starting on or before this date." },
    },
    additionalProperties: false,
  },
  handler: (client, params, actor) => calendarService.listEvents(client, {
    collegeId: actor.collegeId, fromDate: params.from_date, toDate: params.to_date,
  }),
});

// --- Role-aware ERP Copilot tools (this slice) -------------------------
// Every tool below follows three standing rules recorded in
// AI-Governance.md's own "Same-Actor Direct-Action Carve-Out" section:
//   1. Domain-prefixed name (students_*/attendance_*/assessment_*/
//      academic_*/staff_*/finance_*/workflow_*), one Business Service
//      call each — never an intent-branching dispatcher (a single
//      tool can only have one dataClassification/allowedRoles pair,
//      and AI-Governance.md §2 forbids business logic inside a tool
//      wrapper, so a dispatcher can't exist here without breaking
//      both).
//   2. Scope (own class(es)/department/college) is always resolved
//      from `actor` alone, inside the relevant Business Service
//      (visibilityService.getVisibleClassIds/staffService.
//      findHodDepartmentId — the same "context builder" every other
//      scoped read/write in this codebase already shares), never from
//      a caller-supplied classId/departmentId.
//   3. A tool may skip WorkflowService only where the human dashboard
//      action it mirrors is ALREADY a direct write for that exact
//      role today (verified against the real route+service code, not
//      assumed) — everywhere a human already needs approval, the tool
//      creates the identical workflow request instead and never
//      mutates directly. Delete is never a direct tool, full stop.

// Read tools (L1) ------------------------------------------------------

const studentService = require('./studentService');

registerTool({
  name: 'students_roster',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists students within the acting user's own scope — their own taught/tutored class(es), their own "
    + 'department (HOD), or the whole college (principal).',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => studentService.listStudents(
    client,
    { limit: 500 },
    { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
  ),
});

const analyticsService = require('./analyticsService');

registerTool({
  name: 'attendance_summary',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Attendance rate per class within the acting user's own scope (own taught/tutored classes, own "
    + 'department, or whole college), optionally within a date range.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) lower bound.' },
      end_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) upper bound.' },
    },
    additionalProperties: false,
  },
  handler: (client, params, actor) => analyticsService.getAttendanceRateForActor(
    client,
    { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
    { startDate: params.start_date, endDate: params.end_date },
  ),
});

// Same underlying read as attendance_summary, filtered/sorted to
// below-threshold classes — kept as its own tool rather than an
// `intent`/`mode` flag on attendance_summary, per this section's own
// naming rule. The filter itself is a trivial array predicate, not
// query construction, so it stays in this thin handler rather than
// becoming a second analyticsService function.
registerTool({
  name: 'students_low_attendance',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists classes within the acting user's own scope whose attendance rate is at or below a threshold "
    + 'percent (default 75) — the same data as attendance_summary, filtered to the classes that need attention.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      threshold_percent: { type: 'number', description: 'Attendance rate percent at or below which a class is included. Defaults to 75.' },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const rows = await analyticsService.getAttendanceRateForActor(
      client,
      { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
    );
    const threshold = typeof params.threshold_percent === 'number' ? params.threshold_percent : 75;
    return rows.filter((row) => row.attendanceRatePercent !== null && row.attendanceRatePercent <= threshold);
  },
});

const assessmentService = require('./assessmentService');

// Classified Internal here, not the Confidential default
// AI-Governance.md §4's data table gives marks generally — a
// deliberate, documented call (see AI-Governance.md's own new note):
// the same tutor already has full read+write access to these exact
// marks on the human dashboard (recordMark has no extra gate beyond
// assertIsAssignedFaculty), so reading what you can already edit is
// not a new exposure. Kept college-wide unrestricted for principal via
// the same actor-derived scoping every other tool here uses.
registerTool({
  name: 'assessment_marks_summary',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Assessment marks within the acting user's own scope (own taught classes, own department, or whole "
    + 'college), optionally filtered by academic year, subject, or assessment type.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      academic_year: { type: 'string', description: "Optional academic year filter, e.g. '2025-2026'." },
      subject: { type: 'string', description: 'Optional subject filter.' },
      assessment_type_id: { type: 'string', description: 'Optional assessment type filter — either the exact internal id (if already known from a prior tool result) or the assessment type\'s real name (e.g. "Midterm"), resolved to an id internally. Omit if unsure of the exact name rather than guessing one.' },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const assessmentTypeId = params.assessment_type_id
      ? await assessmentService.resolveAssessmentTypeId(client, actor.collegeId, params.assessment_type_id)
      : undefined;
    return assessmentService.listMarksForActor(
      client,
      { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
      { academicYear: params.academic_year, subject: params.subject, assessmentTypeId },
    );
  },
});

const academicService = require('./academicService');

registerTool({
  name: 'academic_class_timetable',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Faculty allocation / timetable for classes within the acting user's own scope (own taught/tutored "
    + 'classes, own department, or whole college).',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => academicService.getClassTimetableForActor(
    client,
    { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
  ),
});

const staffService = require('./staffService');

registerTool({
  name: 'staff_roster',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Lists staff in the acting user's own department (HOD) or the whole college (principal). Not "
    + 'available to plain staff — a tutor has no dashboard reason to browse the staff directory.',
  allowedRoles: ['principal', 'hod'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => staffService.listStaffForActor(
    client,
    { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
  ),
});

const financeService = require('./financeService');

registerTool({
  name: 'finance_status_summary',
  level: 'L1',
  dataClassification: 'Restricted',
  description: 'College-wide fee collection status (fee structures, amounts collected/outstanding). Principal '
    + 'only — fee data is Restricted, and only the principal role has AI access to Restricted data.',
  allowedRoles: ['principal'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client) => financeService.getFeeStatusSummary(client),
});

const workflowService = require('./workflowService');

registerTool({
  name: 'workflow_pending_summary',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Workflow requests currently awaiting the acting user's own approval — the same list the Approvals "
    + 'screen shows, not an exhaustive history of every request ever submitted in their department/college.',
  allowedRoles: ['principal', 'hod'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => workflowService.listPendingForApprover(client, actor.userId),
});

// Direct-write tools (L1 — skip WorkflowService; verified the human
// dashboard path is already direct for these exact roles) -------------

// assessment_record_mark: mirrors mark_attendance_nl's own carve-out
// exactly. recordMark itself re-verifies assertIsAssignedFaculty(classId,
// subject, actorUserId) — the tool grants no authority the acting
// faculty member didn't already have via POST /assessments/marks.
registerTool({
  name: 'assessment_record_mark',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Records (or updates) one student's mark for the acting user's own class/subject — the same "
    + 'recordMark action available on the dashboard. Fails if the acting user is not the assigned Subject Faculty '
    + 'for that class/subject.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      academic_year: { type: 'string', description: "Academic year, e.g. '2025-2026'." },
      class_id: { type: 'string', description: 'The class id, or the class name (e.g. "3rd Sem · CSE-A"), resolved to an id internally.' },
      subject: { type: 'string', description: 'The subject.' },
      assessment_type_id: { type: 'string', description: 'The assessment type id, or its real name (e.g. "Midterm"), resolved to an id internally.' },
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      marks_obtained: { type: 'number', description: 'The mark, stored exactly as given — no grading/weighting is applied.' },
    },
    required: ['academic_year', 'class_id', 'subject', 'assessment_type_id', 'student_id', 'marks_obtained'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [classId, assessmentTypeId, studentId] = await Promise.all([
      academicService.resolveClassId(client, actor.collegeId, params.class_id),
      assessmentService.resolveAssessmentTypeId(client, actor.collegeId, params.assessment_type_id),
      studentService.resolveStudentId(client, actor.collegeId, params.student_id),
    ]);
    return assessmentService.recordMark(
      client,
      {
        academicYear: params.academic_year,
        classId,
        subject: params.subject,
        assessmentTypeId,
        studentId,
        marksObtained: params.marks_obtained,
      },
      { actorUserId: actor.userId },
    );
  },
});

// calendar_create_event / calendar_update_event: two tools, not one
// "manage" tool with a mode flag — createEvent/updateEvent are two
// distinct Business Service methods, per this section's own naming
// rule (governing principle 0/1), even though they share a domain.
// Both direct — calendarService has no workflow step at all, and both
// are principal-only, matching the human dashboard's own calendar.write
// permission.
registerTool({
  name: 'calendar_create_event',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Creates a college calendar event (semester date, holiday, exam window, etc). Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title.' },
      event_type: { type: 'string', description: "Event type, e.g. 'holiday', 'exam'." },
      start_date: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD).' },
      description: { type: 'string', description: 'Optional description.' },
    },
    required: ['title', 'event_type', 'start_date'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => calendarService.createEvent(
    client,
    {
      collegeId: actor.collegeId, title: params.title, eventType: params.event_type, startDate: params.start_date, endDate: params.end_date, description: params.description,
    },
    { actorUserId: actor.userId },
  ),
});

registerTool({
  name: 'calendar_update_event',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Updates an existing college calendar event. Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'The calendar event id to update.' },
      title: { type: 'string', description: 'Optional new title.' },
      event_type: { type: 'string', description: 'Optional new event type.' },
      start_date: { type: 'string', description: 'Optional new ISO date (YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional new ISO date (YYYY-MM-DD).' },
      description: { type: 'string', description: 'Optional new description.' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => calendarService.updateEvent(
    client,
    params.event_id,
    {
      title: params.title, eventType: params.event_type, startDate: params.start_date, endDate: params.end_date, description: params.description,
    },
    { actorUserId: actor.userId, collegeId: actor.collegeId },
  ),
});

// finance_record_payment: markFeePayment has no approval gate at all
// today, by the same design financeService.js's own file comment
// documents for a human caller — "a simple write... not a fee change."
registerTool({
  name: 'finance_record_payment',
  level: 'L1',
  dataClassification: 'Restricted',
  description: "Marks a student's fee payment status (paid/not_paid) for a given fee structure. Principal only.",
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      fee_structure_id: { type: 'string', description: 'The fee structure id — must be the exact internal id from a prior tool result (e.g. finance_status_summary); there is no name to resolve it from, so never guess one.' },
      status: { type: 'string', description: "'paid' or 'not_paid'." },
      receipt_document_id: { type: 'string', description: 'Optional id of a previously uploaded receipt document.' },
    },
    required: ['student_id', 'fee_structure_id', 'status'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return financeService.markFeePayment(
      client,
      {
        collegeId: actor.collegeId, studentId, feeStructureId: params.fee_structure_id, status: params.status, receiptDocumentId: params.receipt_document_id,
      },
      { actorUserId: actor.userId },
    );
  },
});

// students_update_profile: updateStudent itself re-verifies
// assertCanModifyStudent (own class/department/college) — same
// carve-out shape as assessment_record_mark. Lifecycle status is
// deliberately NOT a param here — that always goes through
// students_submit_lifecycle_change (Phase 3) instead, since 4 of its
// values are workflow-gated even for a human and the rest already have
// their own direct route (updateStudentLifecycleStatus) this tool does
// not wrap.
registerTool({
  name: 'students_update_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Updates routine profile fields (phone, address, parent contact, notes — never lifecycle status) "
    + "for a student within the acting user's own scope. Fails if the student is not in the acting user's scope.",
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      phone: { type: 'string', description: "Optional new phone number." },
      address: { type: 'string', description: 'Optional new address.' },
      parent_phone: { type: 'string', description: "Optional new parent phone number." },
      notes: { type: 'string', description: 'Optional new notes.' },
    },
    required: ['student_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return studentService.updateStudent(
      client,
      studentId,
      {
        phone: params.phone, address: params.address, parentPhone: params.parent_phone, notes: params.notes,
      },
      { userId: actor.userId, actorRole: actor.role },
    );
  },
});

// staff_update_profile: updateStaff has no internal per-row scoping
// (routes/staff.js's own `staff.update` permission is already
// principal-only) — same authority as the human dashboard, no more.
registerTool({
  name: 'staff_update_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description: 'Updates routine profile fields for any staff member. Principal only — staff.update is a '
    + "principal-only action on the dashboard too, not HOD's.",
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      staff_id: { type: 'string', description: 'The staff id, or the staff member\'s staff code, resolved to an id internally.' },
      phone: { type: 'string', description: 'Optional new phone number.' },
      designation: { type: 'string', description: 'Optional new designation.' },
      qualification: { type: 'string', description: 'Optional new qualification.' },
      department_id: { type: 'string', description: 'Optional new department id.' },
    },
    required: ['staff_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const staffId = await staffService.resolveStaffId(client, actor.collegeId, params.staff_id);
    return staffService.updateStaff(
      client,
      staffId,
      {
        phone: params.phone, designation: params.designation, qualification: params.qualification, departmentId: params.department_id,
      },
      { userId: actor.userId },
    );
  },
});

// Workflow-submitting tools (L3 — create the same request a human
// submission already uses; never mutate the underlying record
// directly) --------------------------------------------------------

// The service functions these wrap each return their OWN shape (a raw
// workflow_requests row, or an object nesting one under
// `workflowRequest`) — never the notification-row shape
// assertL3ResultNotBypassed's `result.workflow_request_id` check
// happens to already match. This tags the real workflow request's
// id/status onto whatever the service returned, satisfying that same
// generic post-check without changing the check itself or any
// existing service function's own return contract.
function withWorkflowRequestId(result, workflowRequest) {
  return { ...result, workflow_request_id: workflowRequest.id, status: workflowRequest.status };
}

// finance_draft_fee_structure: L1, direct write — createFeeStructure
// itself has no approval gate (a row always lands 'Pending Approval'
// by DB default); the gate is entirely in the separate submit step
// below, same two-tool shape draft_notification/request_notification_send
// already established. Without this tool, finance_submit_fee_structure_change
// would have nothing to submit.
registerTool({
  name: 'finance_draft_fee_structure',
  level: 'L1',
  dataClassification: 'Restricted',
  description: 'Creates a fee structure (academic year, class, category, amount) — lands as Pending Approval, '
    + 'never live until finance_submit_fee_structure_change is submitted and a principal approves it. Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      academic_year: { type: 'string', description: "Academic year, e.g. '2025-2026'." },
      class_id: { type: 'string', description: 'The class id, or the class name (e.g. "3rd Sem · CSE-A"), resolved to an id internally.' },
      fee_category: { type: 'string', description: 'The fee category.' },
      amount: { type: 'number', description: 'The fee amount.' },
    },
    required: ['academic_year', 'class_id', 'fee_category', 'amount'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return financeService.createFeeStructure(
      client,
      {
        collegeId: actor.collegeId, academicYear: params.academic_year, classId, feeCategory: params.fee_category, amount: params.amount,
      },
      { actorUserId: actor.userId },
    );
  },
});

registerTool({
  name: 'finance_submit_fee_structure_change',
  level: 'L3',
  dataClassification: 'Restricted',
  description: 'Submits a previously created fee structure (from finance_draft_fee_structure) for principal '
    + 'approval. Does NOT make it live — a principal must approve via the workflow approvals screen first.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      fee_structure_id: { type: 'string', description: 'The id of a previously created fee structure to submit for approval.' },
    },
    required: ['fee_structure_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const workflowRequest = await financeService.submitFeeStructureApproval(
      client, params.fee_structure_id, { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(workflowRequest, workflowRequest);
  },
});

registerTool({
  name: 'staff_submit_registration',
  level: 'L3',
  dataClassification: 'Internal',
  description: 'Submits a pending staff registration for HOD then principal approval. Does NOT activate the '
    + 'staff member — approval must happen via the workflow approvals screen first. HOD (of that staff member\'s '
    + 'own department) or principal.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      staff_id: { type: 'string', description: 'The id of the pending staff registration to submit for approval, or that staff member\'s staff code, resolved to an id internally.' },
    },
    required: ['staff_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const staffId = await staffService.resolveStaffId(client, actor.collegeId, params.staff_id);
    const workflowRequest = await staffService.submitStaffRegistration(
      client, staffId, { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(workflowRequest, workflowRequest);
  },
});

registerTool({
  name: 'students_submit_lifecycle_change',
  level: 'L3',
  dataClassification: 'Internal',
  description: "Submits a student lifecycle status change (Discontinued/Debarred/Dismissed/Graduated) for "
    + 'principal approval. Does NOT change the status — approval must happen via the workflow approvals screen first.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      new_status: { type: 'string', description: 'One of Discontinued, Debarred, Dismissed, Graduated.' },
      reason: { type: 'string', description: 'Reason for the change.' },
      effective_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) the change should take effect.' },
    },
    required: ['student_id', 'new_status', 'reason'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    const result = await studentService.requestLifecycleStatusChange(
      client,
      studentId,
      { newStatus: params.new_status, reason: params.reason, effectiveDate: params.effective_date },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result, result.workflowRequest);
  },
});

registerTool({
  name: 'students_submit_transfer',
  level: 'L3',
  dataClassification: 'Internal',
  description: 'Submits an internal (same-college) student transfer request for principal approval. Does NOT '
    + 'move the student — approval must happen via the workflow approvals screen first.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      student_id: { type: 'string', description: 'The student id, or the student\'s roll number, resolved to an id internally.' },
      destination_class_id: { type: 'string', description: 'The class id to transfer to, or its class name, resolved to an id internally.' },
      reason: { type: 'string', description: 'Reason for the transfer.' },
    },
    required: ['student_id', 'destination_class_id', 'reason'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [studentId, destinationClassId] = await Promise.all([
      studentService.resolveStudentId(client, actor.collegeId, params.student_id),
      academicService.resolveClassId(client, actor.collegeId, params.destination_class_id),
    ]);
    const result = await studentService.requestInternalTransfer(
      client,
      studentId,
      { destinationClassId, reason: params.reason },
      { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(result, result.workflowRequest);
  },
});

registerTool({
  name: 'academic_submit_timetable_for_approval',
  level: 'L3',
  dataClassification: 'Internal',
  description: "Submits a class's draft timetable for HOD then principal approval. Does NOT approve it — "
    + 'attendance marking for that class stays locked until a human approves via the workflow approvals screen.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id whose timetable should be submitted for approval, or its class name, resolved to an id internally.' },
    },
    required: ['class_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    const workflowRequest = await academicService.submitTimetableForApproval(
      client, classId, { requestedByUserId: actor.userId, origin: 'ai' },
    );
    return withWorkflowRequestId(workflowRequest, workflowRequest);
  },
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
  computeRiskLevel,
  buildActionManifest,
};
