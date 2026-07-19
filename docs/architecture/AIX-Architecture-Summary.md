# AI Experience Layer (AIX) — Architecture Summary

The real pipeline is untouched: `AI Agent → Tool Registry (+ Policy
Gate) → Business Services → Context Builder → Prompt Safety Layer →
LLM`. AIX (`backend/src/services/aiExperience/`) is a new, pure
post-processing stage bolted onto the *end* of that pipeline, inside
`aiService.js`'s three existing return points
(`invokeTool`/`askAboutTool`/`askAgent`). It reads the already-final,
already-authorized `sanitizedContext`/`answer`/`toolUsed`/`actor.role`
and returns a `presentation` object — Markdown, section breakdown,
role framing, follow-up suggestions — added alongside every existing
response field, never replacing one. It never calls a tool, a Business
Service, or the LLM, and never influences which tool ran.

Because it works only in the already-provider-neutral space (plain
JS objects and the LLM's own final text answer), it carries no
dependency on which adapter answered the request — NIM, Gemini,
Claude, or self-hosted are all identical from AIX's point of view, so
no vendor lock-in is introduced.
