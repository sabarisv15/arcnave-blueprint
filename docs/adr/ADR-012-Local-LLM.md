# ADR-012: Local LLM deferred

Status: Deferred (see Decisions-To-Revisit.md)

## Decision
Use a cloud-hosted LLM provider (Gemini) rather than a self-hosted
open-weight model.

## Reasoning
No GPU infrastructure exists yet, and cloud provider cost at current
scale is not a demonstrated problem. The AI layer is designed with
provider as a configurable component (see AI-Governance.md), so this
is not a locked-in choice — it's the default until a concrete reason
to change exists.

## Revisit when
A dedicated GPU server becomes available, or cloud AI cost becomes
significant enough to justify the operational overhead of self-
hosting.
