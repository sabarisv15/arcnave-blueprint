"""Integration tests for the Super Admin Portal API (platform auth +
college creation), and — the part that actually matters for ADR-010 —
proof that the platform sub-app is genuinely isolated from the tenant
request path, not just conventionally separate.

Three kinds of test here:
1. Platform auth / college creation work as plain features.
2. Cross-boundary: a platform token must never work against a
   require_role-gated tenant route, and vice versa.
3. The isolation claim itself: TenantMiddleware/AuthMiddleware must
   never run for a /api/v1/platform/* request. Proven, not assumed
   from Starlette's docs on Mount — same "prove it" discipline as
   test_rls_tenant_isolation.py's pg_backend_pid() check and
   test_request_logging.py's distinct-request-id check.

   First attempt at this used monkeypatch.setattr() on
   TenantMiddleware.dispatch / AuthMiddleware.dispatch with call
   counters — and it failed even on the *tenant* route (the positive
   control), which is itself the finding: Starlette's
   BaseHTTPMiddleware binds `self.dispatch_func = self.dispatch` once
   when the middleware stack is first built, so patching the class
   attribute afterward doesn't affect an already-constructed
   instance's stored bound-method reference. Not a bug — just the
   wrong lever to pull. The reliable lever: request.state.college_id/
   jwt_claims/db are set *only* by TenantMiddleware/AuthMiddleware
   anywhere in this codebase, so directly inspecting whether they
   exist at all on a Request that reached a platform route is
   conclusive regardless of construction timing.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from starlette.requests import Request

from app.core.config import get_settings
from app.platform_app import platform_app
from app.core.security import hash_password
from app.main import app

settings = get_settings()

PLATFORM_PASSWORD = "PlatformPass123!"


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def platform_admin():
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    suffix = uuid.uuid4().hex[:8]
    username = f"platformadmin{suffix}"

    with admin_engine.begin() as conn:
        admin_id = conn.execute(
            text(
                "INSERT INTO platform_admins (username, email, password_hash) "
                "VALUES (:username, :email, :password_hash) RETURNING id"
            ),
            {
                "username": username,
                "email": f"{username}@example.com",
                "password_hash": hash_password(PLATFORM_PASSWORD),
            },
        ).scalar()

    yield {"id": str(admin_id), "username": username, "password": PLATFORM_PASSWORD}

    with admin_engine.begin() as conn:
        conn.execute(text("DELETE FROM colleges WHERE created_by = :admin_id"), {"admin_id": admin_id})
        conn.execute(text("DELETE FROM platform_admins WHERE id = :admin_id"), {"admin_id": admin_id})
    admin_engine.dispose()


@pytest.fixture
def platform_token(client, platform_admin):
    resp = client.post(
        "/api/v1/platform/auth/login",
        json={"username": platform_admin["username"], "password": platform_admin["password"]},
    )
    assert resp.status_code == 200
    return resp.json()["access_token"]


@pytest.fixture
def college_id_factory():
    created: list[str] = []

    def _factory() -> str:
        cid = f"platest{uuid.uuid4().hex[:8]}"
        created.append(cid)
        return cid

    yield _factory

    admin_engine = create_engine(settings.resolved_alembic_database_url)
    with admin_engine.begin() as conn:
        for cid in created:
            conn.execute(text("DELETE FROM colleges WHERE college_id = :cid"), {"cid": cid})
    admin_engine.dispose()


@pytest.fixture
def tenant_with_user():
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    suffix = uuid.uuid4().hex[:8]
    college = {"college_id": f"pbound{suffix}", "subdomain": f"pboundtenant{suffix}"}

    with admin_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO colleges (college_id, name, subdomain) "
                "VALUES (:college_id, :college_id, :subdomain)"
            ),
            college,
        )
        conn.execute(
            text(
                "INSERT INTO users (college_id, username, email, password_hash, role, is_active) "
                "VALUES (:college_id, 'pbounduser', 'pbounduser@example.com', :password_hash, 'staff', true)"
            ),
            {"college_id": college["college_id"], "password_hash": hash_password("TenantPass123!")},
        )

    yield college

    with admin_engine.begin() as conn:
        conn.execute(
            text("DELETE FROM refresh_tokens WHERE college_id = :college_id"),
            {"college_id": college["college_id"]},
        )
        conn.execute(
            text("DELETE FROM users WHERE college_id = :college_id"), {"college_id": college["college_id"]}
        )
        conn.execute(text("DELETE FROM colleges WHERE college_id = :college_id"), college)
    admin_engine.dispose()


# --- Platform login ---


def test_platform_login_succeeds(client, platform_admin):
    resp = client.post(
        "/api/v1/platform/auth/login",
        json={"username": platform_admin["username"], "password": platform_admin["password"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    # No refresh token for platform admins this pass — see
    # Module-00-Platform.md "Known Limitations".
    assert "refresh_token" not in body


def test_platform_login_rejects_wrong_password(client, platform_admin):
    resp = client.post(
        "/api/v1/platform/auth/login",
        json={"username": platform_admin["username"], "password": "wrong password"},
    )
    assert resp.status_code == 401


def test_platform_login_rejects_unknown_username(client):
    resp = client.post(
        "/api/v1/platform/auth/login",
        json={"username": "no-such-admin", "password": "whatever"},
    )
    assert resp.status_code == 401


# --- College creation ---


def test_create_college_succeeds(client, platform_token, college_id_factory):
    college_id = college_id_factory()
    resp = client.post(
        "/api/v1/platform/colleges",
        headers={"authorization": f"Bearer {platform_token}"},
        json={"college_id": college_id, "name": "Test College", "subdomain": college_id},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["college_id"] == college_id
    assert body["subscription_status"] == "trial"


def test_create_college_rejects_duplicate_college_id(client, platform_token, college_id_factory):
    college_id = college_id_factory()
    first = client.post(
        "/api/v1/platform/colleges",
        headers={"authorization": f"Bearer {platform_token}"},
        json={"college_id": college_id, "name": "Test College", "subdomain": college_id},
    )
    assert first.status_code == 201

    second = client.post(
        "/api/v1/platform/colleges",
        headers={"authorization": f"Bearer {platform_token}"},
        json={"college_id": college_id, "name": "Different Name", "subdomain": f"{college_id}-different"},
    )
    assert second.status_code == 409


def test_create_college_rejects_duplicate_subdomain(client, platform_token, college_id_factory):
    college_id = college_id_factory()
    other_college_id = college_id_factory()
    first = client.post(
        "/api/v1/platform/colleges",
        headers={"authorization": f"Bearer {platform_token}"},
        json={"college_id": college_id, "name": "Test College", "subdomain": college_id},
    )
    assert first.status_code == 201

    second = client.post(
        "/api/v1/platform/colleges",
        headers={"authorization": f"Bearer {platform_token}"},
        json={"college_id": other_college_id, "name": "Other College", "subdomain": college_id},
    )
    assert second.status_code == 409


def test_create_college_requires_platform_admin_token(client, college_id_factory):
    college_id = college_id_factory()
    resp = client.post(
        "/api/v1/platform/colleges",
        json={"college_id": college_id, "name": "Test College", "subdomain": college_id},
    )
    assert resp.status_code == 401


# --- Cross-boundary token rejection ---


def test_platform_token_rejected_by_tenant_require_role(client, platform_token):
    resp = client.get("/api/v1/auth/me", headers={"authorization": f"Bearer {platform_token}"})
    assert resp.status_code == 401


def test_tenant_token_rejected_by_platform_require_platform_admin(
    client, tenant_with_user, college_id_factory
):
    login_resp = client.post(
        "/api/v1/auth/login",
        headers={"host": f"{tenant_with_user['subdomain']}.arcnave.test"},
        json={"username": "pbounduser", "password": "TenantPass123!"},
    )
    assert login_resp.status_code == 200
    tenant_access_token = login_resp.json()["access_token"]

    college_id = college_id_factory()
    resp = client.post(
        "/api/v1/platform/colleges",
        headers={"authorization": f"Bearer {tenant_access_token}"},
        json={"college_id": college_id, "name": "Should Not Be Created", "subdomain": college_id},
    )
    assert resp.status_code == 401


# --- Isolation proof ---


@platform_app.get("/_test_only/state_probe")
def _state_probe(request: Request) -> dict:
    """Test-only route, added directly to the real platform_app
    singleton actually mounted at /api/v1/platform in main.py — not a
    throwaway copy. Proving something about what's really mounted
    there requires inspecting that exact object; a fresh, unrelated
    FastAPI() instance (as used in test_rbac.py's require_role subset
    test, deliberately, for a different reason) wouldn't prove
    anything about it.

    request.state.college_id / jwt_claims / db are set *only* by
    TenantMiddleware / AuthMiddleware respectively, nowhere else in
    this codebase (grep confirms it). Their total absence on a request
    that reached this route is conclusive: those middlewares never ran
    for it.
    """
    return {
        "has_college_id": hasattr(request.state, "college_id"),
        "has_jwt_claims": hasattr(request.state, "jwt_claims"),
        "has_db": hasattr(request.state, "db"),
    }


def test_platform_routes_bypass_tenant_and_auth_middleware(client):
    resp = client.get("/api/v1/platform/_test_only/state_probe")
    assert resp.status_code == 200
    assert resp.json() == {"has_college_id": False, "has_jwt_claims": False, "has_db": False}
