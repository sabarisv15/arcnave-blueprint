# ARCNAVE — ERD (Module 0 scope)

This covers only what Module 0 needs: tenants, users, auth, audit,
and configuration. Every module after this adds its own tables here
as it's built — this file grows, it isn't rewritten.

Two schemas, deliberately separate (see ADR-010):
- **Platform schema** — no `college_id`, no RLS. Super Admin only.
- **Tenant schema** — every table has `college_id`, every table has
  an RLS policy.

## Platform schema (no RLS)

```sql
CREATE TABLE platform_admins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE TABLE colleges (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id          TEXT UNIQUE NOT NULL,      -- short code, e.g. 'GPCT' — this is the RLS tenant key
    name                TEXT NOT NULL,
    subdomain           TEXT UNIQUE NOT NULL,       -- e.g. 'gpct' -> gpct.arcnave.com
    subscription_status TEXT NOT NULL DEFAULT 'trial',  -- trial | active | suspended | cancelled
    created_by          UUID REFERENCES platform_admins(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- College Admin profile (Module 2 BusinessRules.md resolution),
    -- added by 1753000000000_college-admin-profile-schema.js. Nullable
    -- — every college created before this migration has no value to
    -- backfill. Single-valued facts only; a college's departments are
    -- a separate table below, not columns here.
    affiliating_university TEXT,
    year_established        INT,
    address                  TEXT
);
```

`affiliating_university`/`year_established`/`address` are the only
columns on this Platform-owned table that `arcnave_app` (the tenant
runtime role) can ever write — via a column-level `GRANT UPDATE
(affiliating_university, year_established, address) ON colleges`, not
a table-wide grant. See `collegeProfileRepository.js` and the
migration's own comment: `colleges` structurally cannot carry the
usual `tenant_isolation` RLS policy (Tenant Middleware reads this
table *before* `app.current_tenant` is set, to discover the
`college_id` in the first place — the same bootstrapping reason
`principal_invitations` below has none), so this column-scoped grant
is the substitute defense-in-depth mechanism, and the repository's own
`WHERE college_id = $1` is the sole thing scoping *which* row an
update reaches.

`colleges.college_id` is the value that ends up in
`SET LOCAL app.current_tenant = '<college_id>'` on every tenant
request. It is never the same as `colleges.id` (internal UUID) —
keep them distinct so the tenant key can stay human-readable and
stable even if internal IDs ever need to change.

```sql
CREATE TABLE principal_invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id      TEXT NOT NULL REFERENCES colleges(college_id),
    email           TEXT NOT NULL,
    token_hash      TEXT NOT NULL,          -- never store the raw token
    created_by      UUID REFERENCES platform_admins(id),
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,            -- null = pending
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`principal_invitations` has a `college_id` column but, like
`platform_admins`/`colleges`, deliberately **no RLS policy** — it must
be look-up-able by an opaque bearer token before the requester has
been resolved to any tenant at all (that's the entire point of an
invitation link). An RLS policy keyed on `app.current_tenant` would
fail closed on every lookup here, since nothing has set that context
yet. See `backend/migrations/1751600000000_principal-invitations.js`
(the Node/node-pg-migrate migration — ADR-016 replaced the original
Python/Alembic one this file used to point at, same table, unchanged)
for the full reasoning and the directional `arcnave_platform`
(SELECT/INSERT/UPDATE) vs. `arcnave_app` (SELECT/UPDATE, no INSERT)
grants that make "the platform creates, the tenant only ever
consumes" a DB-enforced fact.

## Tenant schema (RLS on every table)

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id      TEXT NOT NULL REFERENCES colleges(college_id),
    username        TEXT NOT NULL,
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL,          -- staff | hod | principal
    is_active       BOOLEAN NOT NULL DEFAULT false,
    activated_by    UUID REFERENCES users(id),   -- principal who approved activation
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (college_id, username)
);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id      TEXT NOT NULL REFERENCES colleges(college_id),
    user_id         UUID NOT NULL REFERENCES users(id),
    token_hash      TEXT NOT NULL,           -- never store the raw token
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ
);

CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    college_id      TEXT NOT NULL REFERENCES colleges(college_id),
    user_id         UUID REFERENCES users(id),   -- null if system/AI-initiated
    action          TEXT NOT NULL,
    entity          TEXT NOT NULL,
    entity_id       TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE configurations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id      TEXT NOT NULL REFERENCES colleges(college_id),
    category        TEXT NOT NULL,          -- 'attendance_rules' | 'fee_structure' | 'smtp' | 'sms' | 'ai_provider' | ...
    configuration   JSONB NOT NULL,
    version         INT NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (college_id, category)
);
```

### Departments (College Admin profile, added post-Module-2)

```sql
CREATE TABLE departments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id      TEXT NOT NULL REFERENCES colleges(college_id),
    name            TEXT NOT NULL,
    approved_intake INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (college_id, name)
);
```

A real tenant table, standard RLS (below) — not columns on `colleges`,
because AICTE-style department data is inherently per-department (a
college has more than one, each with its own `approved_intake`); it
can't flatten onto one row the way `colleges.affiliating_university`/
`year_established`/`address` above can. `staff.department` (Module 2)
and Academic's own `department` TEXT column are **not** FK'd to this
table yet — both stay free-text as they are today; normalizing them is
a real, separate future gap, not solved by introducing this table. See
`backend/migrations/1753000000000_college-admin-profile-schema.js`.

## RLS policy pattern (apply to every tenant table)

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users
    USING (college_id = current_setting('app.current_tenant', true));

-- Repeat ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY +
-- CREATE POLICY for every tenant table: refresh_tokens, audit_log,
-- configurations, and every table added by later modules.
```

`FORCE ROW LEVEL SECURITY` is not redundant with `ENABLE` — without it,
the role that owns the table (the migration role) bypasses RLS
entirely, policy or no policy. `FORCE` closes that gap for the owner.
It does not help against a superuser connection, since superusers
bypass RLS unconditionally regardless of `FORCE` — that's why the
running app must connect as a separate, non-superuser role from the
one that runs migrations. See ADR-015.

`current_setting('app.current_tenant', true)` — the `true` second
argument means "return NULL instead of erroring if unset," so a
request that somehow reaches the database without Tenant Middleware
having set the context sees zero rows, not an error that might leak
information via a stack trace. Fail closed, not open.

Tenant Middleware, inside every request's transaction, before any
query:

```sql
SET LOCAL app.current_tenant = '<college_id resolved from JWT/subdomain>';
```

## Verification (required before Module 0 is done — see ADR-002)

Automated integration test: open two requests for two different
tenants on the same pooled connection, assert tenant B's query never
returns tenant A's rows. This is a release gate, not optional.

## What's deliberately not here yet
No `staff`, `students`, `attendance`, or any domain table — those
belong to Modules 1+ and get added to this file when those modules
are actually built, following real decisions made while building
them, not guessed here in advance.
