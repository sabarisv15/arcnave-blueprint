"""Principal invitations: invite-record-now, create-user-later

Implements Option B from docs/modules/Module-00-Platform.md's Known
Limitations writeup on principal invitation, chosen over Option A (a
scoped set_config exception letting arcnave_platform INSERT directly
into users). Option B keeps arcnave_platform's grants on every tenant
table at exactly zero — the platform role creates an invitation row
here, but never touches `users` itself. The principal accepts the
invitation through the normal tenant request path (TenantMiddleware,
RLS, the same `users` INSERT any other tenant-side write would use),
so no new exception to the "platform role never touches tenant data"
property this schema has enforced by construction (zero grants, not
narrow grants) since Module 0's first migration.

This is the first genuinely new migration file since 0001 — until
now, every schema change amended revision 0001 directly because
nothing built on it had shipped. Real git history now exists (see
Module-00-Platform.md), so that habit stops here: a new table is a
new revision, chained via down_revision.

principal_invitations gets NO RLS, deliberately, for the same
structural reason `colleges` has none: the whole point of this table
is to be looked up by an opaque bearer token *before* any tenant
context can possibly be known — the person accepting an invitation
hasn't been resolved to a tenant by TenantMiddleware (no subdomain,
no JWT, no account yet). An RLS policy keyed on
current_setting('app.current_tenant') would fail closed to zero rows
on every single lookup, since app.current_tenant is never set at that
point in the request — that would break the feature outright, not
secure it. `college_id` here is a plain foreign key, read directly by
application code, same treatment as `colleges.id`/`colleges.college_id`
already get.

Grants are directional on purpose, mirroring the one-way flow of the
feature itself:
  - arcnave_platform (SELECT, INSERT, UPDATE): creates invitations.
    UPDATE included for future revoke/resend flows — not built this
    pass, but the invitation is platform-owned data and there's no
    reason to grant SELECT/INSERT without UPDATE only to need a third
    migration the moment a resend feature exists.
  - arcnave_app (SELECT, UPDATE only, NO INSERT): the tenant side only
    ever *consumes* an invitation — looks one up by token_hash, then
    marks it accepted. It never creates one; invitation creation is
    exclusively the platform's job, gated behind require_platform_admin.
    Withholding INSERT here isn't just an application-layer convention
    — even a bug in tenant-side code could not forge a new invitation
    row, regardless of what any route handler does.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-03

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "arcnave_app"
PLATFORM_ROLE = "arcnave_platform"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE principal_invitations (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            college_id      TEXT NOT NULL REFERENCES colleges(college_id),
            email           TEXT NOT NULL,
            token_hash      TEXT NOT NULL,
            created_by      UUID REFERENCES platform_admins(id),
            expires_at      TIMESTAMPTZ NOT NULL,
            accepted_at     TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # No ENABLE/FORCE ROW LEVEL SECURITY, no tenant_isolation policy —
    # see this migration's docstring for why that's deliberate here,
    # unlike every other table with a college_id column.

    op.execute(f"GRANT SELECT, INSERT, UPDATE ON principal_invitations TO {PLATFORM_ROLE}")
    op.execute(f"GRANT SELECT, UPDATE ON principal_invitations TO {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS principal_invitations")
