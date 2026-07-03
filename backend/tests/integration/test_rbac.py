"""RBAC enforcement tests: require_role() + the first real protected
route, GET /api/v1/auth/me.

/api/v1/auth/me is gated to "any authenticated tenant user" — all
three known roles — so it can't itself demonstrate role-subset
rejection (there's no role that's *not* in its allowed set). For that,
a tiny throwaway FastAPI app (not the production `app`) is built here
with one route restricted to a strict subset of roles, wired with the
real AuthMiddleware + require_role so the subset-rejection path is
still exercised through a real HTTP request, not by calling the
dependency function directly.

None of this needs seeded DB fixture data: /me and require_role only
ever read the JWT's already-verified claims, never a DB row. A live
Postgres still needs to be reachable, though — TenantMiddleware (which
every request still passes through) looks up the JWT's college_id
claim against `colleges` regardless of whether the route cares about
the result.
"""
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.deps import require_role
from app.core.config import get_settings
from app.core.security import create_access_token
from app.main import app
from app.middleware.auth import AuthMiddleware

settings = get_settings()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _bearer_headers(**kwargs) -> dict:
    return {"authorization": f"Bearer {create_access_token(**kwargs)}"}


def test_me_returns_401_without_a_token(client):
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_me_returns_401_with_malformed_token(client):
    resp = client.get("/api/v1/auth/me", headers={"authorization": "Bearer not-a-real-jwt"})
    assert resp.status_code == 401


def test_me_returns_401_with_expired_token(client):
    now = datetime.now(timezone.utc)
    expired = jwt.encode(
        {
            "sub": "user-1",
            "college_id": "college-1",
            "role": "staff",
            "iat": now - timedelta(hours=1),
            "exp": now - timedelta(minutes=1),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    resp = client.get("/api/v1/auth/me", headers={"authorization": f"Bearer {expired}"})
    assert resp.status_code == 401


@pytest.mark.parametrize("role", ["staff", "hod", "principal"])
def test_me_returns_200_for_any_tenant_role(client, role):
    headers = _bearer_headers(user_id="user-1", college_id="college-1", role=role)
    resp = client.get("/api/v1/auth/me", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "user-1", "college_id": "college-1", "role": role}


# --- require_role()'s role-subset restriction, via a throwaway app ---
# AuthMiddleware only (no TenantMiddleware needed — require_role never
# touches request.state.college_id or the DB).

_subset_app = FastAPI()
_subset_app.add_middleware(AuthMiddleware)


@_subset_app.get("/restricted")
def _restricted(claims: dict = Depends(require_role("hod", "principal"))) -> dict:
    return {"role": claims["role"]}


@pytest.fixture
def subset_client():
    with TestClient(_subset_app) as c:
        yield c


def test_require_role_returns_401_without_a_token(subset_client):
    resp = subset_client.get("/restricted")
    assert resp.status_code == 401


def test_require_role_rejects_role_outside_allowed_set(subset_client):
    headers = _bearer_headers(user_id="user-1", college_id="college-1", role="staff")
    resp = subset_client.get("/restricted", headers=headers)
    assert resp.status_code == 403


@pytest.mark.parametrize("role", ["hod", "principal"])
def test_require_role_allows_role_in_allowed_set(subset_client, role):
    headers = _bearer_headers(user_id="user-1", college_id="college-1", role=role)
    resp = subset_client.get("/restricted", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"role": role}
