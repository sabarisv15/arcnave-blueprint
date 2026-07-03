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
| Event Bus | Deferred | 2026-07-02 | 2026-07-02 | Medium | Modular monolith becomes distributed, or async cross-service workflows become complex | ADR-006 |
| Redis Task Queue | FastAPI BackgroundTasks | 2026-07-02 | 2026-07-02 | High | Background jobs become CPU-intensive, or queue delays start affecting users (bulk imports, bulk notifications, bulk OCR) | ADR-011 |
| Local LLM | Cloud-hosted (Gemini) | 2026-07-02 | 2026-07-02 | Medium | Dedicated GPU server becomes available, or cloud AI cost becomes significant | ADR-012 |
| Custom Domains | Subdomain-per-tenant | 2026-07-02 | 2026-07-02 | Low | First enterprise customer requests a branded domain | ADR-013 |
| Horizontal Scaling | Single FastAPI instance | 2026-07-02 | 2026-07-02 | Low | Sustained load requires multiple application instances | ADR-014 |

Priority guide:
- **High** — likely relevant within 6–12 months
- **Medium** — revisit as the product grows, no fixed timeline
- **Low** — long-term architectural consideration, not urgent
