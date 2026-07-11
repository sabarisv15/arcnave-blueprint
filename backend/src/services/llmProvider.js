'use strict';

// Module 9 (AI) — the ONE file that knows NVIDIA NIM's specific API
// shape (an OpenAI-compatible /chat/completions endpoint). Every other
// stage of AI-Governance.md §2's pipeline (Tool Registry, Context
// Builder, Prompt Safety Layer) is provider-agnostic by design (§6) —
// swapping providers later means changing this file alone, never the
// pipeline that calls it. This is the last stage: it receives exactly
// the systemPrompt/userPrompt aiPromptSafetyLayer.renderForLlm already
// built (the safety preamble + boundary-wrapped untrusted tool data),
// and does nothing to reinterpret or re-frame that content — it only
// transports it.
//
// Global config only (config.nim.*), not yet per-tenant, despite §6
// naming ConfigurationService/per-tenant provider selection as a
// future option — no tenant has asked for a different provider yet;
// building that now would be speculative ahead of real demand, same
// reasoning that kept the Tool Registry itself waiting for real
// Business Services to exist before it was built (Roadmap.md).

const config = require('../config');

// No provider key configured (config.nim.apiKey is null) — the AI
// "ask" path is unavailable. Never thrown for the plain tool-invoke
// path (aiService.invokeTool), only for aiService.askAboutTool, which
// is the only caller of complete().
class LlmNotConfiguredError extends Error {}

// A configured provider was reached but the call itself failed —
// non-2xx response, a network error, or a response that didn't have
// the shape this function expects. One error class regardless of
// which of those three happened, same reasoning security.js's
// TokenError wraps jsonwebtoken's whole exception hierarchy: a caller
// only needs to know "the LLM call didn't work," not which of several
// transport-level reasons caused it.
class LlmRequestError extends Error {}

function isConfigured() {
  return Boolean(config.nim.apiKey);
}

// A hard timeout — an AI "ask" is a synchronous, user-facing HTTP
// request (routes/ai.js), not a background job like
// notificationService's best-effort email send; a hung upstream call
// must not hang the caller's own request indefinitely.
const REQUEST_TIMEOUT_MS = 30000;

// Shared transport for complete()/completeWithTools()/embed() below —
// the timeout/fetch/status-check/JSON-parse mechanics are identical
// across all three; only the URL path, the request body, and how the
// response is read back differ per caller. Not configured-checked
// here — every caller must still hit that check first via the same
// LlmNotConfiguredError, mirrored in each so the "not configured" path
// never even builds a request body.
async function postJson(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${config.nim.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.nim.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new LlmRequestError(`request to LLM provider failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LlmRequestError(`LLM provider returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new LlmRequestError(`LLM provider returned a non-JSON response: ${err.message}`);
  }
}

async function postChatCompletion(body) {
  return postJson('/chat/completions', body);
}

// systemPrompt/userPrompt are plain strings — aiPromptSafetyLayer.js's
// renderForLlm already did the one thing that matters (framing
// untrusted tool content as inert, boundary-wrapped data). This
// function sends them verbatim as a two-message chat completion
// request; it never concatenates, reorders, or reinterprets them.
async function complete({ systemPrompt, userPrompt }) {
  if (!isConfigured()) {
    throw new LlmNotConfiguredError('no LLM provider is configured (NIM_API_KEY is unset)');
  }

  const payload = await postChatCompletion({
    model: config.nim.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
  });

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const answer = choice && choice.message ? choice.message.content : undefined;
  if (typeof answer !== 'string') {
    throw new LlmRequestError('LLM provider response did not contain choices[0].message.content');
  }

  return answer;
}

// tools: the plain list aiToolRegistry.listTools() already returns
// (`{name, level, dataClassification, description, params}`) — this is
// the ONE place that reshapes it into NIM/OpenAI's own function-
// calling schema (`{type: 'function', function: {name, description,
// parameters}}`), same "provider-specific shape lives only in this
// file" reasoning the module comment gives for complete() above.
// aiService.js never needs to know this shape exists.
//
// Returns `{type: 'tool_call', toolName, arguments}` if the model
// requested a tool, or `{type: 'answer', text}` if it answered
// directly. This is a SUGGESTION ONLY — aiService.askAgent re-runs
// whatever toolName comes back through the real Policy Gate
// (aiToolRegistry.invokeTool) exactly like any other caller-supplied
// tool name; nothing here grants it any trust (AI-Governance.md §3).
// Only the first tool_call is honored if the model returns more than
// one — a single suggested action per turn is this slice's own scope,
// not a multi-tool agent loop.
async function completeWithTools({ systemPrompt, userPrompt, tools }) {
  if (!isConfigured()) {
    throw new LlmNotConfiguredError('no LLM provider is configured (NIM_API_KEY is unset)');
  }

  const payload = await postChatCompletion({
    model: config.nim.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools: tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.params,
      },
    })),
    tool_choice: 'auto',
    temperature: 0.2,
  });

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = choice ? choice.message : null;
  if (!message) {
    throw new LlmRequestError('LLM provider response did not contain choices[0].message');
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length > 0) {
    const fn = toolCalls[0].function || {};
    let toolArguments;
    try {
      toolArguments = fn.arguments ? JSON.parse(fn.arguments) : {};
    } catch (err) {
      throw new LlmRequestError(`LLM tool call arguments were not valid JSON: ${err.message}`);
    }
    return { type: 'tool_call', toolName: fn.name, arguments: toolArguments };
  }

  if (typeof message.content !== 'string') {
    throw new LlmRequestError('LLM provider response contained neither a tool call nor message content');
  }
  return { type: 'answer', text: message.content };
}

// Module 9's RAG slice (documentSearchService.js) — the ONE place that
// knows NIM's own /v1/embeddings shape, same "provider-specific shape
// lives only in this file" reasoning complete()/completeWithTools()
// above already follow. nv-embedqa-e5-v5 (config.nim.embeddingModel's
// default) always returns 1024-dimension vectors — the exact width
// the ai_document_chunks migration's embedding column is fixed at;
// this constant documents that fact, it doesn't enforce it (a caller
// changing NIM_EMBEDDING_MODEL to a different-dimension model would
// need a matching migration, not just a config change).
const EMBEDDING_DIMENSIONS = 1024;

// texts: a non-empty array of strings, embedded in one batched request
// (nv-embedqa-e5-v5 accepts a batch, so a caller embedding several
// chunks doesn't need one round-trip each). inputType: 'passage' when
// embedding content to be indexed/searched-for, 'query' when embedding
// the search question itself — this model's own asymmetric embedding
// convention (a matching query/passage pair is deliberately embedded
// slightly differently for better retrieval quality); there is no
// default, a caller must always choose, since silently getting this
// wrong degrades search quality without ever raising a visible error.
// Returns embeddings in the same order as `texts` (re-sorted by the
// response's own `index` field — NIM does not guarantee response order
// matches request order for a batch).
async function embed(texts, { inputType } = {}) {
  if (!isConfigured()) {
    throw new LlmNotConfiguredError('no LLM provider is configured (NIM_API_KEY is unset)');
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new LlmRequestError('embed() requires a non-empty array of texts');
  }
  if (inputType !== 'query' && inputType !== 'passage') {
    throw new LlmRequestError(`embed() inputType must be 'query' or 'passage', got ${JSON.stringify(inputType)}`);
  }

  const payload = await postJson('/embeddings', {
    model: config.nim.embeddingModel,
    input: texts,
    input_type: inputType,
    // Rather than erroring on a chunk that exceeds the model's own
    // 512-token max input — documentSearchService.js's own CHUNK_SIZE_CHARS
    // keeps chunks well under that in practice, this is a defensive
    // fallback, not the primary length control.
    truncate: 'END',
  });

  const data = Array.isArray(payload && payload.data) ? payload.data : null;
  if (!data || data.length !== texts.length) {
    throw new LlmRequestError('LLM embeddings provider response did not contain one embedding per input text');
  }

  return data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

module.exports = {
  LlmNotConfiguredError,
  LlmRequestError,
  EMBEDDING_DIMENSIONS,
  isConfigured,
  complete,
  completeWithTools,
  embed,
};
