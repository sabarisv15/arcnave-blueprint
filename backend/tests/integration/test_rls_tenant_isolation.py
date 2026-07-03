"""ADR-002's release gate: two tenants sharing one pooled connection
must never see each other's rows.

Everything here runs against a live Postgres (docker compose's `db`
service) — this is deliberately not mocked. RLS is a database-level
guarantee; a test that mocks the database can't verify it.

Two engines matter for different reasons:
- `settings.database_url` (arcnave_app): the runtime role RLS is
  actually meant to constrain. This is what the isolation test uses.
- `settings.resolved_alembic_database_url` (arcnave_admin): owns the
  tables and is a Postgres superuser, so it bypasses RLS unconditionally
  (ADR-015). Used only to seed/clean up fixture data, and as the
  negative control that proves this test suite isn't vacuous.
"""
import uuid

import pytest
from sqlalchemy import create_engine, text

from app.core.config import get_settings

settings = get_settings()


def _backend_pid(conn) -> int:
    """Server-side PID for the physical connection underlying `conn`.

    Used to prove the pooled engine really did reuse one physical
    connection across two "requests" — the exact scenario ADR-002
    rejects bare connection-level `SET` over `SET LOCAL` for. Checking
    the Postgres backend PID is driver-agnostic, unlike introspecting
    SQLAlchemy/psycopg internals.
    """
    return conn.execute(text("SELECT pg_backend_pid()")).scalar()


@pytest.fixture(scope="module")
def two_tenants():
    """Seed two colleges + one user each via the migration-owner
    connection. This bypasses RLS (arcnave_admin is a superuser) —
    that's fine here, it's setup for the test, not the thing under
    test.
    """
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    tenant_a = f"test_a_{uuid.uuid4().hex[:8]}"
    tenant_b = f"test_b_{uuid.uuid4().hex[:8]}"

    with admin_engine.begin() as conn:
        for college_id in (tenant_a, tenant_b):
            conn.execute(
                text(
                    "INSERT INTO colleges (college_id, name, subdomain) "
                    "VALUES (:cid, :cid, :cid)"
                ),
                {"cid": college_id},
            )
            conn.execute(
                text(
                    "INSERT INTO users (college_id, username, email, password_hash, role) "
                    "VALUES (:cid, :username, :email, 'x', 'staff')"
                ),
                {
                    "cid": college_id,
                    "username": f"user_{college_id}",
                    "email": f"{college_id}@example.com",
                },
            )

    yield tenant_a, tenant_b

    with admin_engine.begin() as conn:
        for college_id in (tenant_a, tenant_b):
            conn.execute(text("DELETE FROM users WHERE college_id = :cid"), {"cid": college_id})
            conn.execute(text("DELETE FROM colleges WHERE college_id = :cid"), {"cid": college_id})
    admin_engine.dispose()


@pytest.mark.parametrize("end_mode", ["commit", "rollback"])
def test_tenant_isolation_on_pooled_connection(two_tenants, end_mode):
    """Runs as arcnave_app — the role RLS is actually meant to bind.

    pool_size=1 / max_overflow=0 forces the engine to have exactly one
    physical connection, so acquiring a "new" logical connection for
    the second transaction is guaranteed to hand back the same
    physical one. Verified explicitly via pg_backend_pid(), not just
    assumed from the pool config.
    """
    tenant_a, tenant_b = two_tenants
    engine = create_engine(settings.database_url, pool_size=1, max_overflow=0)
    try:
        conn = engine.connect()
        trans = conn.begin()
        pid_before = _backend_pid(conn)

        conn.execute(
            text("SELECT set_config('app.current_tenant', :t, true)"), {"t": tenant_a}
        )
        rows = conn.execute(text("SELECT college_id FROM users")).fetchall()
        assert [r.college_id for r in rows] == [tenant_a]

        if end_mode == "commit":
            trans.commit()
        else:
            trans.rollback()
        conn.close()

        # New transaction, same pooled connection. No tenant context
        # has been set yet on it — fail-closed must hold: zero rows,
        # not tenant A's row leaking across the transaction boundary.
        with engine.begin() as conn2:
            pid_after = _backend_pid(conn2)
            assert pid_after == pid_before, (
                "test setup bug: pool did not reuse the same physical "
                "connection — this test would prove nothing"
            )

            rows = conn2.execute(text("SELECT college_id FROM users")).fetchall()
            assert rows == [], (
                f"tenant context leaked across a transaction boundary "
                f"(previous transaction ended via {end_mode})"
            )

            conn2.execute(
                text("SELECT set_config('app.current_tenant', :t, true)"), {"t": tenant_b}
            )
            rows = conn2.execute(text("SELECT college_id FROM users")).fetchall()
            assert [r.college_id for r in rows] == [tenant_b]
    finally:
        engine.dispose()


def test_admin_role_bypasses_rls_negative_control(two_tenants):
    """Negative control: the same query, run as arcnave_admin instead
    of arcnave_app, must see both tenants' rows unfiltered.

    This is what proves test_tenant_isolation_on_pooled_connection
    would actually catch a regression (e.g. DATABASE_URL accidentally
    pointed at the admin role) rather than passing vacuously — if RLS
    were silently not filtering at all, this test would look identical
    to the isolation test above.
    """
    tenant_a, tenant_b = two_tenants
    engine = create_engine(settings.resolved_alembic_database_url, pool_size=1, max_overflow=0)
    try:
        with engine.begin() as conn:
            # No tenant context set at all — arcnave_admin isn't
            # subject to the policy regardless (ADR-015).
            rows = conn.execute(
                text("SELECT college_id FROM users WHERE college_id IN (:a, :b)"),
                {"a": tenant_a, "b": tenant_b},
            ).fetchall()
            assert {r.college_id for r in rows} == {tenant_a, tenant_b}
    finally:
        engine.dispose()
