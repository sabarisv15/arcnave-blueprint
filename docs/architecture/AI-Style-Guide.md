# AI Style Guide

Governs how any ARCNAVE AI response is presented to a user, regardless
of which LLM provider generated the underlying answer (NVIDIA NIM,
Gemini, Claude, or a self-hosted model — see `TechStack.md`). This is
a presentation contract, not a tool-authorization one: it never
changes what a tool is allowed to do (`AI-Governance.md` owns that),
only how its already-authorized result is shown.

Implemented by `backend/src/services/aiExperience/` (the AI Experience
Layer, "AIX") and applied to every response `POST /ai/tools/:name/invoke`
(with a question), `POST /ai/tools/:name/invoke` (without one), and
`POST /ai/ask` return, as an additive `presentation` field — see that
file's own header comment for the exact boundary.

## Tone

- Plain, professional, and direct. No filler ("Great question!", "I'd
  be happy to help").
- Second person when addressing the user's own scope ("your class",
  "your department"), never third person about them.
- Never claim an action was taken that no tool actually performed
  (`aiService.js`'s own `AGENT_SYSTEM_PROMPT` already enforces this at
  the LLM level; this layer never contradicts it in presentation).

## Structure — six sections, shown only when relevant

1. **Title** — a short, humanized name for what was answered (derived
   from the tool name, e.g. `attendance_summary` → "Attendance
   summary"; a direct answer with no tool → "Answer").
2. **Summary** — the natural-language answer already produced by the
   LLM/tool pipeline. Never re-run through another instruction-
   following step by this layer — displayed as-is.
3. **Key Metrics** — 1–5 aggregate figures worth seeing at a glance
   (record counts, average rates, totals). Omitted entirely when there
   is nothing to aggregate.
4. **Details** — a Markdown table (list results) or a field list
   (single-record results). Never a raw JSON dump.
5. **Insights** — a short, role-aware framing line (see Personas
   below). Omitted when there is nothing to add beyond the summary.
6. **Recommended Actions** — 3–5 follow-up suggestions, each backed by
   a real, currently-permitted tool (see Follow-up Suggestions below).
   Omitted when none apply.

A section with nothing to show is dropped, never rendered empty
(Response Quality Guard, below).

## Formatting conventions

| Kind | Convention |
|---|---|
| Dates | `en-IN` locale, e.g. `19 Jul 2026` |
| Percentages | one decimal place with a `%` suffix, e.g. `76.8%` |
| Currency | `₹` prefix with `en-IN` grouping, e.g. `₹12,500` |
| Tables | Markdown pipe tables, humanized column headers |
| Lists | Markdown bullet lists |
| Identifiers | never shown — every internal `*Id`/`*_id`/UUID-shaped
  value is excluded from Key Metrics and Details |

## Empty states

An empty result (`[]`, `null`, or no matching records) always renders
a plain, specific sentence — never a blank section, never a raw `[]`.
Default: *"No matching records were found for this request."*

## Error messages

Error responses are unchanged by this layer (`mapAiToolError` in
`routes/ai.js` remains the single source of truth for status codes and
`detail` messages) — the AIX layer only formats successful `200`
bodies.

## Clarification style

Unchanged from `aiService.js`'s existing `AGENT_SYSTEM_PROMPT`: when a
question is too vague to match a specific tool, the assistant asks a
short, specific clarifying question rather than guessing. This layer
does not add a second clarification mechanism.

## Recommendation style

Recommended Actions are concrete and tool-backed ("Draft a
notification about attendance"), never vague ("consider following
up"). A suggestion is only ever shown when the underlying tool exists
in the Tool Registry and is on the acting role's own `allowedRoles`
list — see `followUpSuggestions.js`.

## Role Personas

Same underlying data, different emphasis — the data itself is never
altered:

| Role | Scope framing | Detail level |
|---|---|---|
| Tutor (`staff`) | "your class" | Full row-level detail |
| HOD (`hod`) | "your department" | Full row-level detail, department-comparison framing |
| Principal (`principal`) | "the college" | Aggregate-first; a capped, truncated detail table with a note |
| Platform Admin (`platform_admin`) | "this tenant" | Aggregate-first |

## Response Quality Guard

Before any response leaves the AI Experience Layer, it is checked for:

- No raw internal ids in Key Metrics or Details.
- No empty sections.
- No duplicated lines within Insights or Recommended Actions.
- A graceful empty-state message when there is no data.
- Recommended Actions shown only when at least one is genuinely
  supported for the acting role.

Implemented in `backend/src/services/aiExperience/qualityGuard.js`.
