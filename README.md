# ARCNAVE Blueprint

Drop this whole folder into the root of your project repo. Structure:

```
your-project/
├── CLAUDE.md                          ← auto-loaded by Claude Code
├── docs/
│   ├── architecture/
│   │   ├── Architecture.md            ← stable, read first
│   │   ├── BusinessRules.md
│   │   ├── AI-Governance.md
│   │   ├── DevelopmentStandards.md
│   │   ├── Roadmap.md
│   │   ├── Decisions-To-Revisit.md
│   │   └── ERD.drawio                 ← not yet created
│   ├── adr/                           ← ADR-001 through ADR-014
│   └── modules/                       ← created as each module starts
└── (your existing code)
```

## How to use this with Antigravity / Claude Code

- **Claude Code** (inside Antigravity or standalone): `CLAUDE.md` at
  the project root is read automatically at the start of every
  session — no need to re-explain the architecture each time.
- **Antigravity's native agent** (Gemini or Claude selected directly):
  point it at `docs/architecture/Architecture.md` and
  `docs/architecture/BusinessRules.md` explicitly if it doesn't pick
  up `CLAUDE.md` on its own.
- Either way: read `Architecture.md` and `BusinessRules.md` before
  generating any backend code. They're authoritative.

## What's still missing
- `ERD.drawio` — table-level schema with the RLS policy pattern
  shown. Build this before Module 0 migrations, since repositories,
  migrations, and RLS policies all depend on it.
- `docs/modules/Module-00-Platform.md` — write this at the start of
  Module 0, following the template in `Roadmap.md`.
