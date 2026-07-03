# ARCNAVE — Development Standards

One page. Discipline, not bureaucracy — this is a solo project, not
a team with a PR-review board.

## Rules

1. Every module has unit tests before it's considered done.
2. Every migration is reversible.
3. Repositories never call other repositories.
4. Services own business logic; repositories own query mechanics only.
5. No raw SQL outside repositories.
6. All APIs live under `/api/v1/` (or the current version).
7. Every tenant-scoped query is protected by PostgreSQL RLS — verify
   with the two-tenant-on-one-pooled-connection integration test
   before considering a module's data layer done.
8. `DocumentService` owns all file storage. No other service, and no
   AI tool, writes to Storage directly.
9. `WorkflowService` owns all approvals — human-initiated and every
   AI Level 3 (Act) action alike.
10. AI tools call Business Services only. Never a repository, never
    storage, never raw SQL.
11. Build vertically per module (ERD → migration → repository →
    service → API → UI → tests), not horizontally by layer across
    all modules.
12. After every completed major module, or every quarter (whichever
    comes first): 15-minute review of `Decisions-To-Revisit.md`. For
    each entry, update `Last Reviewed`, or open a new ADR if the
    decision has actually changed.
13. Every non-trivial or contested architectural decision gets an ADR
    with a status (`Proposed` / `Accepted` / `Deferred` /
    `Superseded` / `Deprecated`) and, where relevant, a "Revisit
    When" trigger condition — not a decision buried in chat history
    or a commit message.
