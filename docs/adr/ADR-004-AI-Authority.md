# ADR-004: AI authority levels (L1/L2/L3)

Status: Accepted

## Decision
Every AI tool is classified into one of three authority levels:
L1 Inform (read-only, no approval), L2 Generate (produces a file or
draft, no external effect, no approval), L3 Act (sends something or
mutates a real record — always requires human approval via
WorkflowService, no exceptions).

## Alternatives considered
- **Case-by-case judgment per tool**: rejected. Without a hard,
  stated boundary, it's easy to "temporarily" let a convenient tool
  skip approval, and that erosion is exactly the failure mode this
  policy exists to prevent.
- **Blanket human approval for all AI actions, including reads**:
  rejected as impractical — it would make the AI assistant useless
  for its core purpose (fast lookups, summaries).

## Reasoning
The one thing every L3 action shares is that it reaches outside the
system's own reasoning into the real world (a parent's phone, a
production record). That's exactly the class of action where an AI
mistake is expensive and hard to undo, so it's the one class that
gets a hard, structural gate rather than a judgment call.

## Consequences
- WorkflowService becomes the single approval gate for both human-
  initiated and AI-initiated actions — one mechanism, not two.
- The AI is never given a hard-delete tool, even at L3 with approval,
  for attendance/fees/marks records (soft-delete only).
