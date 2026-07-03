# ADR-015: Separate DB roles for migrations vs. runtime app traffic

Status: Accepted

## Decision
The database role that runs Alembic migrations (`arcnave_admin` /
`POSTGRES_USER`) and the role the FastAPI app connects as
(`arcnave_app`) are always different roles. `arcnave_admin` owns every
table. `arcnave_app` owns nothing, is never granted superuser, and is
created separately in `docker/postgres/init/01-app-role.sh`. Wired via
two distinct connection strings in `docker-compose.yml`:
`ALEMBIC_DATABASE_URL` (migrations) and `DATABASE_URL` (runtime).

## Alternatives considered
- **Single role for both migrations and runtime traffic**: rejected.
  This is the default in most starter templates and it quietly
  defeats RLS — see Reasoning.

## Reasoning
This follows directly from ADR-002: RLS closes the query-filtering
gap, but it only binds on connections that are actually subject to
policies in the first place. PostgreSQL RLS has two ways to not be
subject to a policy, and they are not the same bypass:

1. **Table owner bypass.** By default, a table's owner is exempt from
   its own RLS policies. `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
   (set on every tenant table in the Module 0 migration) closes this
   gap — once `FORCE` is set, even the owning role is subject to the
   policy.
2. **Superuser bypass.** Superuser connections bypass RLS
   unconditionally. This is not a setting; `FORCE ROW LEVEL SECURITY`
   has no effect on it. There is no policy-level fix.

The official `postgres` Docker image provisions `POSTGRES_USER` as a
superuser. That role also owns every table, because it's the role
Alembic connects as to run `CREATE TABLE`. So for `arcnave_admin`
specifically, `FORCE ROW LEVEL SECURITY` does nothing — the superuser
bypass already lets it through regardless. The only thing that
actually protects tenant data from a misbehaving query is that the
*running application* never uses that role. `arcnave_app` is a plain,
non-superuser role with only the grants it needs (see the Module 0
migration), so `FORCE ROW LEVEL SECURITY` is what makes RLS bind for
it.

`FORCE ROW LEVEL SECURITY` is still worth setting even though it's
inert against `arcnave_admin` today: it's what would protect a future
deployment where the migration-owner role isn't a superuser, and
leaving it off would be a silent gap the moment that assumption
changes.

## Consequences
- Migrations and the running app must always use different
  credentials — never point `DATABASE_URL` at `ALEMBIC_DATABASE_URL`'s
  role, even for convenience in local dev.
- `arcnave_app` must never be granted `SUPERUSER`, and must never be
  made the owner of any tenant table.
- Every new tenant table added by a future module's migration must
  explicitly `GRANT` the subset of privileges `arcnave_app` actually
  needs (see the audit_log SELECT/INSERT-only grant in the Module 0
  migration for an example of *not* defaulting to full CRUD). There is
  no ownership shortcut that gets this for free.
