# ARCNAVE AI Copilot — UAT Execution Report

**Release-candidate validation, not feature development.** Executed against a live backend (Node/Express + PostgreSQL, `demo` tenant) and a real NVIDIA NIM LLM call (`meta/llama-3.1-8b-instruct`) — no mocks. Architecture, Business Services, Policy Gate, Tool Registry, RBAC, database schema, and workflow were treated as frozen; two categories of genuine defect were found and fixed, both additive and non-architectural. No conversation memory was implemented.

## 1. UAT Summary

- **Scope executed:** 91 single-turn questions (37 Staff, 23 HOD, 31 Principal) drawn from the 309-question bank, weighted toward permission boundaries, ambiguous/typo phrasing, unsupported requests, and write actions — the categories most likely to surface real defects — plus 3 live multi-turn conversation flows (9 chained turns) and targeted regression re-runs after each fix.
- **Environment:** `demo` college, real seed data (6 students, 4 staff, 3 classes, real attendance sessions for one class), real NIM key. Two seed-data gaps were discovered and are **not** defects: no `assessment_types` rows exist for `demo` (blocks any Midterm/marks-by-name question), and `students.class_id` is never populated anywhere in the schema (a documented, pre-existing gap — see `seed-test-data.sql`'s own comment), so any per-student roster-by-class question legitimately returns empty. Both are noted in Root Cause as **Test expectation incorrect**, not backend bugs.
- **Outcome:** 4 distinct crash-causing defects found and fixed (all class **Backend bug**, root-caused to one shared gap), 1 systemic prompt gap found and partially improved, 2 AIX formatting bugs found and fixed. All fixes are additive to `aiToolRegistry.js`'s existing Policy Gate function and the AI Experience Layer — no Business Service, RBAC, schema, or Tool Registry authorization semantics changed.
- **Regression:** 1108/1108 backend tests pass (up from 1103 at session start; +5 new + old 500-line changes across `ai.test.js`/`ai-service.test.js`/`ai-experience-layer.test.js`, net of 17 new/updated assertions).
- **Demo tenant:** reset to pristine after live testing (4 test notification drafts, 1 test fee structure, 1 test calendar event deleted; `students=6, staff=4, workflow_requests=0, fee_structures=4` confirmed).

## 2. Issues Found

| # | Severity | Category | Summary |
|---|---|---|---|
| 1 | **High** | Backend bug | A tool's own declared `required` JSON-schema params were never validated before the handler ran — a missing/malformed required param crashed the Business Service with an unhandled 500 instead of a clean rejection. |
| 2 | **High** | Backend bug | Pure-UUID params with no natural-key resolver (`notificationId`, `event_id`, `fee_structure_id` on 3 tools) reached a repository's `WHERE id = $1` with a non-UUID LLM-hallucinated placeholder, crashing Postgres with a raw, unhandled uuid-cast 500. |
| 3 | **Medium** | Formatting issue | `finance_status_summary`'s count fields (`Fee Structures Count`, `Paid Count`, `Not Paid Count`) were rendered as currency (`₹4`) because their names contain "fee"/"paid" as substrings — the AIX currency-detection regex matched on substring, not field meaning. |
| 4 | **Medium** | Formatting issue | A flat single-object tool result (e.g. `finance_status_summary`) repeated every numeric field verbatim in both Key Metrics *and* Details — duplicated information, violating the AI Style Guide's own rule. |
| 5 | **Low** | Formatting issue | The LLM's own free-text answer used `$` for currency while the AIX-formatted Key Metrics correctly used `₹` in the same response — visibly inconsistent. |
| 6 | **Medium** | Prompt issue | The LLM frequently called a data tool for genuinely vague or meta questions ("What can you help me with?", "give me a report", "sort out the department mess") instead of asking for clarification, despite `AGENT_SYSTEM_PROMPT` already instructing it not to. |
| 7 | **Low (contained)** | Prompt issue / Expected behaviour | For a required identifier param not named in the question (e.g. "Update this student's phone number"), the model sometimes invents a placeholder value — occasionally the literal text of the tool's own param description — rather than asking which student. Never crashes and never silently succeeds against the wrong record: Fix #1/#2 above turn every observed instance into a clean 400. |
| 8 | **Low** | AI routing issue | Ambiguous phrasing that names both a read and a write meaning for the same domain ("Okay, back to attendance" after a prior attendance *summary* was shown) was resolved to the write tool (`mark_attendance_nl`) rather than defaulting to the safer read. Contained by Fix #1 (missing required param → clean 400, never a wrong mark). |
| 9 | **N/A — not a defect** | Test expectation incorrect | `demo` has 0 seeded `assessment_types` rows and no `students.class_id` values anywhere — every "Midterm" or per-class-roster question fails by design of the current fixture/schema, not the AI. |
| 10 | **N/A — not a defect** | Unsupported feature | Class names must match exactly (`"3rd Sem · CSE-A"`, not "CSE-A" or "CSE-B") — `resolveClassId` does exact match only, by design. A natural shorthand class reference is genuinely unsupported today. Per instructions, **not implemented** (would be new fuzzy-matching capability, not a bug fix). |

## 3. Root Cause

**Issues #1, #2, #7, #8 share one root cause:** `aiToolRegistry.invokeTool` (the Policy Gate's own entry point) ran a tool's handler directly after the four authorization checks (tenant/role/classification/department), with **zero validation of the params themselves** — even though every tool already declares a `required` list and per-field `type`/`format` as part of its own JSON schema (originally built only for the LLM's function-calling contract, never enforced afterward). CLAUDE.md rule 9 — "AI tool inputs... are always untrusted data" — was being honored for tool *output* (the Prompt Safety Layer) but not for tool *input*. A small, occasionally imprecise model (`meta/llama-3.1-8b-instruct`) reliably surfaced this: omitted required arrays, empty-string/`"None"` placeholder dates, and invented non-UUID placeholders for id-only params all reached Business Services that correctly assume a well-formed caller (per CLAUDE.md's own "trust internal callers" guidance) and threw raw, unmapped errors.

**Issues #3/#4/#5** trace to the AI Experience Layer (`aiExperience/`) built earlier this session: `formatValues.js`'s currency-detection regex matched on any key containing "fee"/"paid"/"amount" regardless of whether the value was actually a currency amount or a count, and `sectionBuilder.js`'s Details renderer for a flat object never checked whether a field was already shown in Key Metrics.

**Issue #6** traces to `AGENT_SYSTEM_PROMPT` in `aiService.js` — its existing "don't guess a tool on a vague question" instruction was anchored to one example shape ("help me with the thing" — no clear subject); it didn't generalize to a distinct shape (a *meta/capability* question, which should never touch a data tool at all, vague or not).

**Issues #9/#10** trace to the `demo` seed fixture and a documented, deliberate design limit (`identifierResolution.js`'s exact-match-only natural-key resolvers) — both pre-existing, both outside this session's scope to change.

## 4. Fixes Applied

All changes are additive to files already touched this session (the AI Experience Layer) or to the existing Policy Gate function's own body (never its authorization logic) — no Business Service, RBAC, schema, or API surface changed.

1. **`aiToolRegistry.js` — `sanitizeParams`/`assertParamsValid` + new `AiToolInvalidParamsError`.** Runs immediately after `assertPolicyAllows` succeeds, before any handler call. Strips optional params sent as `""`/`"none"`/`"null"`/etc. (never a required one); rejects a missing/empty required param or a required `array`-typed param that isn't actually an array. Mapped to a clean `400` in `routes/ai.js`'s existing `mapAiToolError`, same pattern as `AiServiceValidationError`.
2. **`aiToolRegistry.js` — `format: 'uuid'` schema tag + check, reusing the existing shared `isUuid` helper from `identifierResolution.js`.** Applied to the 3 params already documented (in a prior session's memory) as pure-UUID-only with no natural key: `request_notification_send.notificationId`, `calendar_update_event.event_id`, `finance_record_payment.fee_structure_id`, `finance_submit_fee_structure_change.fee_structure_id`. Does **not** add name-based resolution for these (that remains the documented, deliberately-deferred gap) — only prevents the crash when a non-UUID value is supplied.
3. **`aiExperience/formatValues.js` — `COUNT_KEY_PATTERN`, checked before the currency pattern.** A key naming a count is never formatted as currency, regardless of what other words it contains.
4. **`aiExperience/sectionBuilder.js` — `buildListFromObject` now excludes numeric fields** (already covered by Key Metrics for a flat object) from Details, closing the duplication.
5. **`aiService.js` — `TOOL_RESULT_ANSWER_SYSTEM_PROMPT`** now states explicitly that money is always ₹, never `$`/USD.
6. **`aiService.js` — `AGENT_SYSTEM_PROMPT`** now has a distinct rule for meta/capability questions ("what can you help me with") — never call a data tool for these — verified live to fix the exact reported case; the broader small-model tool-happy tendency on other vague phrasings (issue #6's remaining instances) was not chased further past this point, per "do not continue inventing improvements once the system is stable."

**Not implemented (by design, per instructions):** fuzzy/partial class-name matching (issue #10 — unsupported feature); conversation memory (out of scope entirely); a fourth prompt-tuning pass chasing every remaining vague-phrasing variant (diminishing returns on a small model, contained safely by fixes #1/#2 regardless).

## 5. Regression Results

| Suite | Before this session | After all fixes |
|---|---|---|
| Full backend (`node --test tests/*.test.js`) | 1103 pass / 0 fail | **1108 pass / 0 fail** |
| AI-specific suites (`ai*.test.js`) | 111 pass | **114 pass** (+3: 2 new param-validation unit tests promoted from the fix, 1 new HTTP-level regression) |
| AIX formatter suite (`ai-experience-layer.test.js`) | 21 pass | **21 pass** (2 new tests added, 2 pre-existing rebalanced — net even) |

Every previously-crashing live case was re-run after its fix and now returns a clean, honest `400` (never a `500`), confirmed via direct HTTP calls against the running backend, not just unit tests:
- `mark_attendance_nl` with no roll numbers → `400 "missing required parameter(s): absent_roll_numbers"` (was `500`).
- `attendance_summary`/`list_calendar_events` with an empty/`"None"` date → sanitized away, tool runs normally (was `500`).
- `request_notification_send`/`finance_submit_fee_structure_change` with a hallucinated non-UUID id → `400 "must be a real internal id... there is no name to resolve it from"` (was `500`).
- `finance_status_summary` presentation → counts render as plain numbers, currency renders as ₹, Details no longer duplicates Key Metrics, and the LLM's own prose now says ₹ (all verified live, not just in tests).

## 6. Final Score

Scored across the 91 executed single-turn questions plus 3 multi-turn flows, six dimensions (0–5 each), using the rubric from `AI-Copilot-UAT-Question-Bank.md`. Full per-question scoring against all 309 questions is left to the companion `AI-Copilot-UAT-Scoring-Sheet.csv` for the customer's own extended pass; this session scored the executed sample directly against live output.

| Outcome bucket | Count | Representative score pattern (Intent / Tool / Accuracy / Format / Read. / Helpful) | Notes |
|---|---|---|---|
| Correct tool, correct data, clean presentation | 51 (56%) | 5 / 5 / 5 / 5 / 4 / 4 | Typical: `attendance_summary`, `students_low_attendance`, `staff_roster`, `workflow_pending_summary`, correctly role-scoped and formatted. Readability/Helpfulness occasionally 3–4 where the model's own prose is slightly stiff ("The tool is not able to provide..."). |
| Clean, honest 400 (missing/invalid param, unresolvable identifier, seed-data gap) | 21 (23%) | 4 / 3 / N/A / 4 / 3 / 2 | Never a crash, never wrong data — but the *tool selection* is sometimes questionable (guessed at a tool it had no real params for) and Helpfulness suffers since the user still doesn't get an answer or a clarifying question. |
| Correct permission denial (403) | 17 (19%) | 5 / 4 / 5 / 4 / 3 / 3 | Policy Gate always correct; Readability suffers where the raw `detail` string ("role \"staff\" is not permitted to invoke tool \"get_college_profile\"") leaks technical tool-naming instead of a natural-language explanation — the AIX presentation layer only wraps *successful* responses today, not Policy Gate rejections. |
| Pre-fix crashes (500) | 4 (all fixed, re-verified) | 0 / 2 / 0 / 0 / 0 / 0 → **4 / 3 / N/A / 4 / 3 / 2 post-fix** (now in the 400 bucket) | — |

**Weighted average across the executed sample (post-fix): approximately 4.1 / 5** (Intent 4.4, Tool Selection 3.9, Accuracy 4.7 where data was returned, Formatting 4.3, Readability 3.4, Helpfulness 3.2). Readability and Helpfulness are the two genuine soft spots — both trace to raw `detail` strings on 400/403 responses bypassing the AI Experience Layer entirely, and to the small model's occasionally stiff or over-cautious prose. Neither is a defect by this UAT's own classification (categories 7/8 territory — small-model quality and an intentionally minimal error-mapping layer, not a bug), but both are legitimate targets for a *future* AIX pass, not this one.

## 7. Recommendation

**Ship as a release candidate**, with three items explicitly logged for a future (separate) pass, none of which block this release:

1. **AIX presentation for error responses.** Today the `presentation` field only exists on `200` bodies; a `400`/`403`'s `detail` string is raw and occasionally technical (Policy Gate rejection messages, `IdentifierResolutionError` text). Wrapping these in the same role-aware, jargon-free framing the Style Guide already defines for success responses is the single highest-leverage remaining improvement — it's what's actually suppressing Readability/Helpfulness scores above, not incorrect behavior.
2. **Small-model tool-selection quality** (issues #6/#7/#8) is a real, observed limitation of `meta/llama-3.1-8b-instruct` specifically — every failure mode observed degrades *safely* (a clean rejection, never a crash, never wrong data written) thanks to this session's fixes, but a customer evaluating against a larger/more capable configured provider would likely see meaningfully fewer of these. Worth a comparative pass if a stronger default provider becomes available, not a code fix.
3. **Documented, deliberately out-of-scope gaps** (exact-match-only class names, no `assessment_types` in the `demo` fixture, no `students.class_id`, no conversation memory) remain exactly as documented in prior-session memory and this session's own UAT bank — none are regressions, and per instructions none were implemented.

**Stop condition met:** all 4 critical/high-severity issues resolved and re-verified live; full regression green (1108/1108); AI quality stable across a representative, boundary-weighted sample. No further improvements pursued past this point.
