# ADR-016: Express (Node.js, plain JavaScript) replaces FastAPI (Python)

Status: Accepted

## Decision

The backend is rewritten on Express (Node.js, plain JavaScript) —
not FastAPI/Python. This replaces the entire application layer built
in Module 0: routes, middleware, services, repositories, the ORM/DB
client, and the migration tool. It does not replace the database
design underneath them — see Consequences.

## Reasoning

This is a solo-maintainer productivity and comprehension call, not a
performance or correctness one. Nothing about FastAPI was found to be
wrong: RLS enforcement, the tenant/platform isolation, JWT auth, and
every test built in Module 0 worked exactly as designed. The reason to
switch is that JavaScript is where the maintainer has deeper working
fluency, and for a solo-maintainer project sustained over many modules,
how quickly the maintainer can read, extend, and debug their own code
matters more than the architectural tidiness Pydantic/SQLAlchemy/
FastAPI's type system offered on paper. Module 0 is small enough, and
was completed recently enough, that the switch is affordable now and
only gets more expensive to make later, once Student/Staff/Academic/
Attendance are built on top of it.

Plain JavaScript, not TypeScript — see Alternatives considered.

## Alternatives considered

- **Stay on FastAPI/Python.** Rejected. Nothing technical forces this
  move; it's rejected anyway because the underlying problem (working
  in a language the maintainer is less fluent in, for the entire
  remaining life of the project) doesn't go away on its own, and Module
  0 is the cheapest point at which to absorb the cost of switching.
- **NestJS.** Rejected. NestJS's decorator-heavy, dependency-injection,
  Angular-inspired structure reintroduces a large fraction of the same
  ceremony this move is trying to get away from — ADR-004/AI-Governance
  and this whole project already prefer direct, readable code over
  framework magic (see the LangGraph rejection in ADR-004's reasoning
  for the same instinct applied elsewhere). Express's minimalism is the
  point, not an accident to route around.
- **TypeScript (with Express).** Rejected, at least for now. TypeScript
  buys real safety, but it's still a second layer of ceremony (types,
  a build step, `tsconfig`) on top of learning/re-learning the runtime
  itself — and the entire motivation for this switch is removing
  friction, not relocating it from Python's type system to a different
  one. Not a permanent rejection: revisit once the plain-JS codebase is
  large enough that the lack of static types is a demonstrated
  maintenance cost, not a theoretical one — same "wait for a real
  trigger" discipline as every row in `Decisions-To-Revisit.md`.

## Consequences

- **Module 0's application code is being rewritten from scratch.**
  Every route, middleware, service, and repository written in Python
  is deleted, not translated line-by-line and not kept running
  alongside the new code. The old `backend/` tree remains fully
  recoverable from git history (`git log`, `git show`) if ever needed
  as a reference — it is not being force-deleted from history, only
  removed from the working tree going forward.
- **The PostgreSQL schema, RLS policies, and role model are not being
  redesigned.** `ADR-002` (RLS), `ADR-010` (platform isolation), and
  `ADR-015` (the arcnave_admin/arcnave_app/arcnave_platform role
  split) all still hold exactly as reasoned — none of that reasoning
  was about Python. The schema (Module 0's `0001`/`0002` migrations)
  is re-implemented against a different migration tool and a different
  DB client library, faithfully — not re-thought.
- **The existing CI workflow (`.github/workflows/ci.yml`) is Python-
  specific** (pip install, ruff, `alembic upgrade head`, pytest) and
  does not work against a Node codebase. It is being explicitly
  disabled with a clear comment marking it broken-pending-rebuild,
  rather than left in place to fail on every push once Node code
  lands. A Node-based CI workflow is rebuilt once real Node tests
  exist to run.
- **The RLS leak test is re-proven, not assumed.** Module 0's original
  build order re-verified tenant isolation as the very first thing
  built on the schema; the same discipline applies here even though
  the SQL is unchanged — a different client library's pooling behavior
  is exactly the kind of thing ADR-002 already insists on testing
  empirically rather than trusting from documentation.
- Every other Module 0 slice (tenant middleware, JWT auth, RBAC,
  request-scoped logging, the Super Admin Portal API, Configuration
  Service, principal invitation) is rebuilt incrementally in Node, in
  the same order it was originally built, as separate follow-up work —
  not attempted in one pass.
