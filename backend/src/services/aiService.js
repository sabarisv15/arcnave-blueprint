'use strict';

// Module 9 (AI) — thin orchestrator gluing the Tool Registry (+ Policy
// Gate), Context Builder, Prompt Safety Layer, and the LLM provider
// (services/llmProvider.js, NVIDIA NIM) into the three real entry
// points routes/ai.js calls. AI-Governance.md §2/§3's full pipeline:
//   AI Agent -> Tool Registry -> Business Services
//            -> Context Builder -> Prompt Safety Layer -> LLM
// invokeTool stops at the sanitized context blob (caller names the
// tool, no question asked); askAboutTool runs the same pipeline and
// sends that sanitized blob plus the caller's own question to the LLM
// (aiPromptSafetyLayer.renderForLlm); askAgent is the same pipeline
// again but with tool SELECTION also delegated to the LLM (the caller
// supplies only a question, no toolName) — it still runs whatever the
// LLM picks through the exact same invokeTool/Policy Gate as the other
// two, never a separate or looser path.

const aiToolRegistry = require('./aiToolRegistry');
const aiContextBuilder = require('./aiContextBuilder');
const aiPromptSafetyLayer = require('./aiPromptSafetyLayer');
const configurationService = require('./configurationService');
const auditLogRepository = require('../repositories/auditLogRepository');

// askAboutTool/askAgent given an empty/non-string question — raised
// before any Policy Gate check or LLM call, same "guard before any
// work" pattern every other *ValidationError in this codebase already
// uses.
class AiServiceValidationError extends Error {}

// The agent's own operating instructions for tool selection — a
// different concern from aiPromptSafetyLayer's renderForLlm (which
// frames untrusted TOOL DATA, not the assistant's behavior), so it
// lives here, not there. Deliberately says "never claim to have taken
// an action no tool performed" — the one thing worth guarding against
// even at L1 (Inform-only): a model confabulating that it did
// something the Policy Gate never actually ran.
//
// The explicit "do NOT call a tool" instruction below was added after
// a real live-verification run against NVIDIA NIM (meta/llama-3.1-8b-
// instruct): the model called get_college_profile for "what is the
// capital of France?" under the original, softer "if a tool CAN
// answer, call it" wording — a small/tool-happy model reads "can" too
// broadly. Tightened to require the tool's specific purpose to
// actually match the question, with an explicit unrelated-question
// example, which fixed it (see .ai/RESULT.md's "live NIM verification"
// entry for the before/after).
const AGENT_SYSTEM_PROMPT = "You are ARCNAVE's campus assistant. Each tool is for a specific, narrow purpose "
  + '(e.g. reading THIS college\'s own profile, or drafting/sending a notification) — call a tool ONLY when '
  + "the user's question specifically asks for what that exact tool does. If the question is general "
  + "knowledge, small talk, or anything the tools don't specifically cover, answer directly yourself and do "
  + 'NOT call any tool (example: "what is the capital of France?" has nothing to do with any available tool '
  + '— answer it directly). Never claim to have taken an action (sending a message, changing a record) that '
  + 'no tool actually performed. If the question is too vague or general to clearly identify which specific '
  + 'entity, record, or action it is about (e.g. it names no student/staff/class, no clear action, or could '
  + 'reasonably match several unrelated tools), do NOT guess a tool — answer directly instead, asking the '
  + 'user a short, specific question about what they need (example: "help me with the thing" has no clear '
  + 'subject — ask what they need help with, don\'t call a tool at random).';

// Added for the summary step below (askAgent's tool_call branch only)
// — a live UAT pass found two related gaps once a tool actually ran:
// (1) the caller got no natural-language answer at all, only the raw
// tool data; (2) when a tool's own scope/action differs from what the
// question literally named (e.g. the Policy Gate always scopes a read
// to the actor's own department, never a department they named; or no
// delete tool exists so a lifecycle-change request was submitted
// instead), the response gave no hint that a substitution happened.
// This system prompt is appended to (never replaces)
// aiPromptSafetyLayer.SAFETY_PREAMBLE — the untrusted-data boundary
// framing itself is untouched, this is purely an additional behavioral
// instruction the orchestrator (this file) adds on top, same
// separation of concerns the file already keeps between "how tool
// data is framed" (that file) and "how the agent should behave" (this
// constant, same as AGENT_SYSTEM_PROMPT above).
const TOOL_RESULT_ANSWER_SYSTEM_PROMPT = 'Answer the question in plain, natural language using only the '
  + 'untrusted tool data below — never invent facts beyond it. If the data is scoped differently than the '
  + "question literally asked for (e.g. the user named a different department, class, or college, but this "
  + "tool always returns only the acting user's own scope), say so explicitly rather than presenting the data "
  + 'as if it answers the literal question. If this tool represents a different action than the one the user '
  + 'literally asked for (e.g. they asked to delete something but this tool only submits a status-change '
  + 'request for approval), say so explicitly. Keep the answer short.';

function listTools() {
  return aiToolRegistry.listTools();
}

// Runs the whole pipeline for a single tool call: Policy Gate ->
// handler (a Business Service) -> Context Builder -> Prompt Safety
// Layer, then an audit log entry recording what ran and for whom —
// same "write the fact" pattern workflowService.submitRequest already
// uses for workflow_request_submitted. Only reached once the Policy
// Gate has already allowed the call — a rejection throws out of
// aiToolRegistry.invokeTool before any handler, and before this
// function's audit-log call, ever runs.
async function invokeTool(client, toolName, params, { actor } = {}) {
  const result = await aiToolRegistry.invokeTool(toolName, { client, actor, params });
  const tool = aiToolRegistry.getTool(toolName);

  const contextEntry = aiContextBuilder.buildToolContext({
    toolName,
    dataClassification: tool.dataClassification,
    data: result,
  });
  const sanitizedContext = aiPromptSafetyLayer.buildSanitizedContext([contextEntry]);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: actor.collegeId,
    userId: actor.userId,
    action: 'ai_tool_invoked',
    entity: 'ai_tools',
    entityId: null,
    metadata: { toolName },
  });

  return sanitizedContext;
}

// Same pipeline as invokeTool, plus the LLM step: the tool still runs
// and still gets its own ai_tool_invoked audit row (invokeTool's own,
// unchanged) regardless of what happens next — the tool call and the
// LLM call are two distinct events, and a downstream LLM failure
// (unconfigured provider, a network error) must not retroactively make
// the already-completed, already-audited tool invocation look like it
// never happened.
async function askAboutTool(client, toolName, params, question, { actor } = {}) {
  if (!question || typeof question !== 'string') {
    throw new AiServiceValidationError('question is required and must be a non-empty string');
  }

  const sanitizedContext = await invokeTool(client, toolName, params, { actor });
  const { systemPrompt, userPrompt } = aiPromptSafetyLayer.renderForLlm(sanitizedContext, question);
  const { adapter, config: aiConfig } = await configurationService.getAiConfig(client, actor.collegeId);
  const answer = await adapter.complete(aiConfig, { systemPrompt, userPrompt });

  return { ...sanitizedContext, question, answer };
}

// Generates the natural-language answer for a successful tool call —
// askAgent's tool_call branch only (askAboutTool already has its own
// equivalent, unchanged, driven by the caller's explicit follow-up
// question rather than a fixed instruction). Reuses
// aiPromptSafetyLayer.renderForLlm's own systemPrompt/userPrompt
// exactly as askAboutTool does (the untrusted-data boundary framing is
// never touched here); TOOL_RESULT_ANSWER_SYSTEM_PROMPT and the tool's
// own registry description are appended to the systemPrompt only —
// both are this codebase's own trusted, developer-authored text, never
// retrieved/caller content, so neither needs rule 9's boundary
// wrapping the tool DATA itself still gets.
async function summarizeToolResult(sanitizedContext, question, tool, adapter, aiConfig) {
  const { systemPrompt, userPrompt } = aiPromptSafetyLayer.renderForLlm(sanitizedContext, question);
  const combinedSystemPrompt = `${systemPrompt}\n\n${TOOL_RESULT_ANSWER_SYSTEM_PROMPT}\n\n`
    + `The tool that was called: ${tool.name} — ${tool.description}`;
  return adapter.complete(aiConfig, { systemPrompt: combinedSystemPrompt, userPrompt });
}

// The tool-selection entry point (routes/ai.js's POST /ai/ask): the
// caller names no tool, only a question — the LLM picks one (or none)
// from the registry's own list. Whatever it picks is never trusted
// directly; it's re-run through the exact same invokeTool (Policy Gate
// -> handler -> Context Builder -> Prompt Safety Layer, including its
// own ai_tool_invoked audit log) any other caller of this pipeline
// uses — no new gate, no special path. A hallucinated/unknown tool
// name fails exactly like any other caller naming a bad tool would
// (AiToolNotFoundError out of aiToolRegistry.invokeTool) — a clean,
// existing rejection, not a crash, and not a case this function needs
// to special-case (AI-Governance.md §3: tool invocation is only ever
// triggered by the authenticated user's own request; the LLM's
// suggestion carries no authority of its own).
async function askAgent(client, question, { actor } = {}) {
  if (!question || typeof question !== 'string') {
    throw new AiServiceValidationError('question is required and must be a non-empty string');
  }

  const tools = aiToolRegistry.listTools();
  const { adapter, config: aiConfig } = await configurationService.getAiConfig(client, actor.collegeId);
  const decision = await adapter.completeWithTools(aiConfig, {
    systemPrompt: AGENT_SYSTEM_PROMPT,
    userPrompt: question,
    tools,
  });

  if (decision.type === 'tool_call') {
    const sanitizedContext = await invokeTool(client, decision.toolName, decision.arguments || {}, { actor });
    const tool = aiToolRegistry.getTool(decision.toolName);
    const answer = await summarizeToolResult(sanitizedContext, question, tool, adapter, aiConfig);
    return {
      ...sanitizedContext, question, toolUsed: decision.toolName, answer,
    };
  }

  // No tool was picked. The direct answer still passes through the
  // Prompt Safety Layer's own envelope (preamble/boundary markers)
  // before reaching the caller, so every /ai/ask response has the same
  // shape regardless of which path executed — not because the LLM's
  // own generated text is "untrusted tool data" in rule 9's sense (it
  // isn't retrieved/tool content, so it doesn't need the boundary-
  // wrapping that content does), but so a caller never has to branch
  // on response shape to know whether a tool ran.
  const sanitizedContext = aiPromptSafetyLayer.buildSanitizedContext([]);
  return { ...sanitizedContext, question, toolUsed: null, answer: decision.text };
}

module.exports = {
  AiServiceValidationError,
  listTools,
  invokeTool,
  askAboutTool,
  askAgent,
};
