# ARCNAVE — Decisions To Revisit

This is not an ADR. It's a parking lot for decisions made
deliberately, on purpose, for now — so they don't get silently
re-litigated, and so they don't get silently forgotten either.

Governance rule (see DevelopmentStandards.md): after every completed
major module, or every quarter — whichever comes first — spend 15
minutes on this table. For each row, either update `Last Reviewed`
(even if the answer is "no change") or open a new ADR if the
decision actually changes.

| Decision | Current Choice | Deferred On | Last Reviewed | Priority | Revisit Trigger | ADR |
|---|---|---|---|---|---|---|
| Event Bus | Deferred | 2026-07-02 | 2026-07-03 | Medium | Modular monolith becomes distributed, or async cross-service workflows become complex | ADR-006 |
| Redis Task Queue | FastAPI BackgroundTasks | 2026-07-02 | 2026-07-03 | High | Background jobs become CPU-intensive, or queue delays start affecting users (bulk imports, bulk notifications, bulk OCR) | ADR-011 |
| Local LLM | Cloud-hosted (Gemini) | 2026-07-02 | 2026-07-03 | Medium | Dedicated GPU server becomes available, or cloud AI cost becomes significant | ADR-012 |
| Custom Domains | Subdomain-per-tenant | 2026-07-02 | 2026-07-03 | Low | First enterprise customer requests a branded domain | ADR-013 |
| Horizontal Scaling | Single FastAPI instance | 2026-07-02 | 2026-07-03 | Low | Sustained load requires multiple application instances | ADR-014 |

## Review log

**2026-07-03, post Module 0** (DevelopmentStandards.md rule 12's
"after every completed major module" trigger). All five rows assessed
individually against what Module 0 actually built, not rubber-stamped
— see each ADR's own "Review — 2026-07-03" section for the full
reasoning. No `Current Choice` changed for any row; no new ADR needed.
Two rows had something real worth recording, not just a date bump:
- **Event Bus**: principal invitation was the first genuine
  cross-boundary (platform -> tenant) workflow built, and a shared DB
  table sufficed with no pub/sub — affirmative evidence for staying
  deferred.
- **Horizontal Scaling**: the RLS pooled-connection test suite already
  empirically verified the exact `SET LOCAL`/pooling mechanism this
  ADR flagged as needing re-verification under a load balancer,
  de-risking (not resolving) that specific trigger.
Redis Task Queue, Local LLM, and Custom Domains: genuinely no change
— reasoning recorded in each ADR for why, including an explicit note
that this module's manual DB-seeding tooling is developer-time
scaffolding, not evidence about the Redis Task Queue decision.

Priority guide:
- **High** — likely relevant within 6–12 months
- **Medium** — revisit as the product grows, no fixed timeline
- **Low** — long-term architectural consideration, not urgent
