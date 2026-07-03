"""Integration tests for ConfigurationService: generic JSONB config
store mechanics (get/set round trip, optimistic-concurrency version
conflicts, audit logging, RBAC), plus a real cross-tenant isolation
test specific to this table and this code path — not assumed from
test_rls_tenant_isolation.py already proving RLS at the schema level
in general, same "prove it, don't assume it" discipline as everywhere
else in this codebase.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.core.security import hash_password
from app.main import app

settings = get_settings()

PASSWORD = "ConfigTestPass123!"


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _seed_tenant(admin_engine, label: str) -> dict:
    suffix = uuid.uuid4().hex[:8]
    college = {"college_id": f"cfg{label}{suffix}", "subdomain": f"cfgtenant{label}{suffix}"}
    with admin_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO colleges (college_id, name, subdomain) "
                "VALUES (:college_id, :college_id, :subdomain)"
            ),
            college,
        )
        for role in ("principal", "staff", "hod"):
            conn.execute(
                text(
                    "INSERT INTO users (college_id, username, email, password_hash, role, is_active) "
                    "VALUES (:college_id, :username, :email, :password_hash, :role, true)"
                ),
                {
                    "college_id": college["college_id"],
                    "username": f"{role}user",
                    "email": f"{role}user@example.com",
                    "password_hash": hash_password(PASSWORD),
                    "role": role,
                },
            )
    return college


def _cleanup_tenant(admin_engine, college: dict) -> None:
    with admin_engine.begin() as conn:
        conn.execute(
            text("DELETE FROM audit_log WHERE college_id = :college_id"),
            {"college_id": college["college_id"]},
        )
        conn.execute(
            text("DELETE FROM configurations WHERE college_id = :college_id"),
            {"college_id": college["college_id"]},
        )
        conn.execute(
            text("DELETE FROM refresh_tokens WHERE college_id = :college_id"),
            {"college_id": college["college_id"]},
        )
        conn.execute(
            text("DELETE FROM users WHERE college_id = :college_id"), {"college_id": college["college_id"]}
        )
        conn.execute(text("DELETE FROM colleges WHERE college_id = :college_id"), college)


@pytest.fixture
def tenant():
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    college = _seed_tenant(admin_engine, "a")
    yield college
    _cleanup_tenant(admin_engine, college)
    admin_engine.dispose()


def _login(client, college: dict, username: str) -> str:
    resp = client.post(
        "/api/v1/auth/login",
        headers={"host": f"{college['subdomain']}.arcnave.test"},
        json={"username": username, "password": PASSWORD},
    )
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _headers(college: dict, token: str | None = None) -> dict:
    headers = {"host": f"{college['subdomain']}.arcnave.test"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


# --- Basic mechanics ---


def test_get_configuration_returns_404_when_unset(client, tenant):
    token = _login(client, tenant, "principaluser")
    resp = client.get("/api/v1/configurations/attendance_rules", headers=_headers(tenant, token))
    assert resp.status_code == 404


def test_set_and_get_configuration_round_trip(client, tenant):
    token = _login(client, tenant, "principaluser")
    put_resp = client.put(
        "/api/v1/configurations/attendance_rules",
        headers=_headers(tenant, token),
        json={"configuration": {"grace_minutes": 10}, "expected_version": None},
    )
    assert put_resp.status_code == 200
    body = put_resp.json()
    assert body["version"] == 1
    assert body["configuration"] == {"grace_minutes": 10}

    get_resp = client.get("/api/v1/configurations/attendance_rules", headers=_headers(tenant, token))
    assert get_resp.status_code == 200
    assert get_resp.json()["configuration"] == {"grace_minutes": 10}
    assert get_resp.json()["version"] == 1


def test_set_configuration_rejects_wrong_expected_version(client, tenant):
    token = _login(client, tenant, "principaluser")
    client.put(
        "/api/v1/configurations/fee_structure",
        headers=_headers(tenant, token),
        json={"configuration": {"a": 1}, "expected_version": None},
    )
    resp = client.put(
        "/api/v1/configurations/fee_structure",
        headers=_headers(tenant, token),
        json={"configuration": {"a": 2}, "expected_version": 99},
    )
    assert resp.status_code == 409


def test_set_configuration_rejects_nonzero_expected_version_on_create(client, tenant):
    token = _login(client, tenant, "principaluser")
    resp = client.put(
        "/api/v1/configurations/brand_new_category",
        headers=_headers(tenant, token),
        json={"configuration": {"a": 1}, "expected_version": 1},
    )
    assert resp.status_code == 409


def test_set_configuration_version_increments_on_successive_updates(client, tenant):
    token = _login(client, tenant, "principaluser")
    headers = _headers(tenant, token)

    v1 = client.put(
        "/api/v1/configurations/smtp",
        headers=headers,
        json={"configuration": {"host": "a"}, "expected_version": None},
    ).json()
    assert v1["version"] == 1

    v2 = client.put(
        "/api/v1/configurations/smtp",
        headers=headers,
        json={"configuration": {"host": "b"}, "expected_version": 1},
    ).json()
    assert v2["version"] == 2

    v3 = client.put(
        "/api/v1/configurations/smtp",
        headers=headers,
        json={"configuration": {"host": "c"}, "expected_version": 2},
    ).json()
    assert v3["version"] == 3


def test_set_configuration_creates_audit_log_row(client, tenant):
    token = _login(client, tenant, "principaluser")
    resp = client.put(
        "/api/v1/configurations/branding",
        headers=_headers(tenant, token),
        json={"configuration": {"color": "blue"}, "expected_version": None},
    )
    assert resp.status_code == 200

    admin_engine = create_engine(settings.resolved_alembic_database_url)
    with admin_engine.begin() as conn:
        row = conn.execute(
            text(
                "SELECT action, entity, entity_id, metadata FROM audit_log "
                "WHERE college_id = :college_id AND entity_id = 'branding'"
            ),
            {"college_id": tenant["college_id"]},
        ).first()
    admin_engine.dispose()

    assert row is not None
    assert row.action == "configuration_updated"
    assert row.entity == "configurations"
    assert row.metadata["old_version"] is None
    assert row.metadata["new_version"] == 1


# --- RBAC ---


def test_write_requires_principal_role(client, tenant):
    for role in ("staff", "hod"):
        token = _login(client, tenant, f"{role}user")
        resp = client.put(
            "/api/v1/configurations/approval_policies",
            headers=_headers(tenant, token),
            json={"configuration": {"x": 1}, "expected_version": None},
        )
        assert resp.status_code == 403


def test_write_requires_authentication(client, tenant):
    resp = client.put(
        "/api/v1/configurations/approval_policies",
        headers=_headers(tenant),
        json={"configuration": {"x": 1}, "expected_version": None},
    )
    assert resp.status_code == 401


def test_read_allowed_for_staff_and_hod(client, tenant):
    principal_token = _login(client, tenant, "principaluser")
    client.put(
        "/api/v1/configurations/templates",
        headers=_headers(tenant, principal_token),
        json={"configuration": {"x": 1}, "expected_version": None},
    )
    for role in ("staff", "hod"):
        token = _login(client, tenant, f"{role}user")
        resp = client.get("/api/v1/configurations/templates", headers=_headers(tenant, token))
        assert resp.status_code == 200


def test_read_requires_authentication(client, tenant):
    resp = client.get("/api/v1/configurations/templates", headers=_headers(tenant))
    assert resp.status_code == 401


# --- Cross-tenant isolation ---


def test_cross_tenant_configuration_is_isolated(client):
    """The real check: two tenants configuring the *same* category
    name must never see each other's value, exercised through the
    actual ConfigurationService/repository code path — not just
    trusted because RLS was already proven at the schema level.
    """
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    college_a = _seed_tenant(admin_engine, "x")
    college_b = _seed_tenant(admin_engine, "y")
    try:
        token_a = _login(client, college_a, "principaluser")
        token_b = _login(client, college_b, "principaluser")

        put_a = client.put(
            "/api/v1/configurations/shared_category_name",
            headers=_headers(college_a, token_a),
            json={"configuration": {"tenant": "A"}, "expected_version": None},
        )
        put_b = client.put(
            "/api/v1/configurations/shared_category_name",
            headers=_headers(college_b, token_b),
            json={"configuration": {"tenant": "B"}, "expected_version": None},
        )
        assert put_a.status_code == 200
        assert put_b.status_code == 200
        # Both created independently at version 1 — if tenant B's
        # write had collided with tenant A's row, this would be a 409
        # or version 2, not two independent version-1 creates.
        assert put_a.json()["version"] == 1
        assert put_b.json()["version"] == 1

        get_a = client.get(
            "/api/v1/configurations/shared_category_name", headers=_headers(college_a, token_a)
        )
        get_b = client.get(
            "/api/v1/configurations/shared_category_name", headers=_headers(college_b, token_b)
        )
        assert get_a.json()["configuration"] == {"tenant": "A"}
        assert get_b.json()["configuration"] == {"tenant": "B"}
    finally:
        _cleanup_tenant(admin_engine, college_a)
        _cleanup_tenant(admin_engine, college_b)
        admin_engine.dispose()
