"""Integration tests for tenant-side JWT auth (login/refresh/logout),
hit through a real FastAPI TestClient against a live Postgres.

Platform Admin auth is out of scope — see app/services/auth_service.py
module docstring and ADR-010.
"""
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.core.security import hash_password
from app.main import app

settings = get_settings()

VALID_PASSWORD = "correct horse battery staple"


@pytest.fixture(scope="module")
def tenant_with_user():
    """Seed one college + one active user with a real argon2 hash, via
    the admin/migration connection (bypasses RLS — this is fixture
    setup, not the thing under test).
    """
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    suffix = uuid.uuid4().hex[:8]
    college = {"college_id": f"auth{suffix}", "subdomain": f"authtenant{suffix}"}

    with admin_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO colleges (college_id, name, subdomain) "
                "VALUES (:college_id, :college_id, :subdomain)"
            ),
            college,
        )
        user_id = conn.execute(
            text(
                "INSERT INTO users (college_id, username, email, password_hash, role, is_active) "
                "VALUES (:college_id, 'authuser', 'authuser@example.com', :password_hash, 'staff', true) "
                "RETURNING id"
            ),
            {"college_id": college["college_id"], "password_hash": hash_password(VALID_PASSWORD)},
        ).scalar()

    yield {"college": college, "user_id": str(user_id), "username": "authuser"}

    with admin_engine.begin() as conn:
        conn.execute(
            text("DELETE FROM refresh_tokens WHERE college_id = :college_id"),
            {"college_id": college["college_id"]},
        )
        conn.execute(
            text("DELETE FROM users WHERE college_id = :college_id"),
            {"college_id": college["college_id"]},
        )
        conn.execute(text("DELETE FROM colleges WHERE college_id = :college_id"), college)
    admin_engine.dispose()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _headers(tenant_with_user):
    return {"host": f"{tenant_with_user['college']['subdomain']}.arcnave.test"}


def _login(client, tenant_with_user, password=VALID_PASSWORD):
    return client.post(
        "/api/v1/auth/login",
        headers=_headers(tenant_with_user),
        json={"username": tenant_with_user["username"], "password": password},
    )


def test_login_issues_access_and_refresh_tokens(client, tenant_with_user):
    resp = _login(client, tenant_with_user)
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"

    claims = jwt.decode(
        body["access_token"], settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
    )
    assert claims["college_id"] == tenant_with_user["college"]["college_id"]
    assert claims["sub"] == tenant_with_user["user_id"]
    assert claims["role"] == "staff"


def test_login_rejects_wrong_password(client, tenant_with_user):
    resp = _login(client, tenant_with_user, password="wrong password")
    assert resp.status_code == 401


def test_login_rejects_unknown_username(client, tenant_with_user):
    resp = client.post(
        "/api/v1/auth/login",
        headers=_headers(tenant_with_user),
        json={"username": "no-such-user", "password": VALID_PASSWORD},
    )
    assert resp.status_code == 401


def test_login_rejects_inactive_user(client, tenant_with_user):
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET is_active = false WHERE id = :user_id"),
            {"user_id": tenant_with_user["user_id"]},
        )
    try:
        resp = _login(client, tenant_with_user)
        assert resp.status_code == 401
    finally:
        with admin_engine.begin() as conn:
            conn.execute(
                text("UPDATE users SET is_active = true WHERE id = :user_id"),
                {"user_id": tenant_with_user["user_id"]},
            )
        admin_engine.dispose()


def test_refresh_rotates_and_old_token_stops_working(client, tenant_with_user):
    old_refresh = _login(client, tenant_with_user).json()["refresh_token"]

    refresh_resp = client.post(
        "/api/v1/auth/refresh",
        headers=_headers(tenant_with_user),
        json={"refresh_token": old_refresh},
    )
    assert refresh_resp.status_code == 200
    new_tokens = refresh_resp.json()
    assert new_tokens["refresh_token"] != old_refresh
    assert new_tokens["access_token"]

    reuse_resp = client.post(
        "/api/v1/auth/refresh",
        headers=_headers(tenant_with_user),
        json={"refresh_token": old_refresh},
    )
    assert reuse_resp.status_code == 401


def test_refresh_reuse_of_revoked_token_is_logged(client, tenant_with_user, caplog):
    refresh_token = _login(client, tenant_with_user).json()["refresh_token"]

    first = client.post(
        "/api/v1/auth/refresh",
        headers=_headers(tenant_with_user),
        json={"refresh_token": refresh_token},
    )
    assert first.status_code == 200

    with caplog.at_level("WARNING"):
        second = client.post(
            "/api/v1/auth/refresh",
            headers=_headers(tenant_with_user),
            json={"refresh_token": refresh_token},
        )
    assert second.status_code == 401
    assert any(
        "refresh_token_reuse_detected" in record.getMessage() for record in caplog.records
    )


def test_logout_revokes_refresh_token(client, tenant_with_user):
    refresh_token = _login(client, tenant_with_user).json()["refresh_token"]

    logout_resp = client.post(
        "/api/v1/auth/logout",
        headers=_headers(tenant_with_user),
        json={"refresh_token": refresh_token},
    )
    assert logout_resp.status_code == 204

    reuse_resp = client.post(
        "/api/v1/auth/refresh",
        headers=_headers(tenant_with_user),
        json={"refresh_token": refresh_token},
    )
    assert reuse_resp.status_code == 401


def test_logout_is_idempotent_for_unknown_token(client, tenant_with_user):
    resp = client.post(
        "/api/v1/auth/logout",
        headers=_headers(tenant_with_user),
        json={"refresh_token": "not-a-real-token"},
    )
    assert resp.status_code == 204


def test_password_reset_returns_501(client):
    resp = client.post("/api/v1/auth/password-reset", json={"email": "someone@example.com"})
    assert resp.status_code == 501
