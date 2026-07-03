"""Integration test for TenantMiddleware: proves tenant resolution and
set_tenant_context() wiring actually work through a real FastAPI
request — not just at the raw-SQL level (see
test_rls_tenant_isolation.py for that guarantee underneath this one).

Hits /api/v1/whoami via FastAPI's TestClient with different Host /
X-College-Code headers and asserts each request only ever sees its
own tenant's context, including across a sequence of alternating
requests — the middleware-level analogue of the RLS test's pooled-
connection leak check.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.core.security import create_access_token
from app.main import app

settings = get_settings()


def _bearer_for(college_id: str) -> str:
    return f"Bearer {create_access_token(user_id='test-user-id', college_id=college_id, role='staff')}"


@pytest.fixture(scope="module")
def two_colleges():
    """Seed two colleges via the migration-owner connection. No RLS
    involved here — colleges carries none (ADR-010) — this is just
    fixture setup for tenant resolution to have something real to
    resolve against.
    """
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    suffix = uuid.uuid4().hex[:8]
    tenant_a = {"college_id": f"tma{suffix}", "subdomain": f"tenanta{suffix}"}
    tenant_b = {"college_id": f"tmb{suffix}", "subdomain": f"tenantb{suffix}"}

    with admin_engine.begin() as conn:
        for tenant in (tenant_a, tenant_b):
            conn.execute(
                text(
                    "INSERT INTO colleges (college_id, name, subdomain) "
                    "VALUES (:college_id, :college_id, :subdomain)"
                ),
                tenant,
            )

    yield tenant_a, tenant_b

    with admin_engine.begin() as conn:
        for tenant in (tenant_a, tenant_b):
            conn.execute(text("DELETE FROM colleges WHERE college_id = :college_id"), tenant)
    admin_engine.dispose()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _host_for(subdomain: str) -> str:
    return f"{subdomain}.arcnave.test"


def test_whoami_resolves_tenant_from_subdomain(client, two_colleges):
    tenant_a, _ = two_colleges
    resp = client.get("/api/v1/whoami", headers={"host": _host_for(tenant_a["subdomain"])})
    assert resp.status_code == 200
    assert resp.json()["college_id"] == tenant_a["college_id"]


def test_whoami_resolves_tenant_from_explicit_college_code(client, two_colleges):
    _, tenant_b = two_colleges
    resp = client.get(
        "/api/v1/whoami",
        headers={"x-college-code": tenant_b["college_id"]},
    )
    assert resp.status_code == 200
    assert resp.json()["college_id"] == tenant_b["college_id"]


def test_whoami_rejects_conflicting_subdomain_and_code(client, two_colleges):
    tenant_a, tenant_b = two_colleges
    resp = client.get(
        "/api/v1/whoami",
        headers={
            "host": _host_for(tenant_a["subdomain"]),
            "x-college-code": tenant_b["college_id"],
        },
    )
    assert resp.status_code == 400


def test_whoami_agrees_when_subdomain_and_code_match(client, two_colleges):
    tenant_a, _ = two_colleges
    resp = client.get(
        "/api/v1/whoami",
        headers={
            "host": _host_for(tenant_a["subdomain"]),
            "x-college-code": tenant_a["college_id"],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["college_id"] == tenant_a["college_id"]


def test_whoami_resolves_tenant_from_jwt_claim(client, two_colleges):
    tenant_a, _ = two_colleges
    resp = client.get(
        "/api/v1/whoami",
        headers={"authorization": _bearer_for(tenant_a["college_id"])},
    )
    assert resp.status_code == 200
    assert resp.json()["college_id"] == tenant_a["college_id"]


def test_whoami_agrees_when_jwt_and_subdomain_match(client, two_colleges):
    tenant_a, _ = two_colleges
    resp = client.get(
        "/api/v1/whoami",
        headers={
            "host": _host_for(tenant_a["subdomain"]),
            "authorization": _bearer_for(tenant_a["college_id"]),
        },
    )
    assert resp.status_code == 200
    assert resp.json()["college_id"] == tenant_a["college_id"]


def test_whoami_rejects_conflicting_jwt_and_subdomain(client, two_colleges):
    """The case explicitly called out when the JWT-claim TODO was
    completed: a JWT claiming tenant A combined with a subdomain
    resolving to tenant B must 400, never silently pick either one.
    """
    tenant_a, tenant_b = two_colleges
    resp = client.get(
        "/api/v1/whoami",
        headers={
            "host": _host_for(tenant_b["subdomain"]),
            "authorization": _bearer_for(tenant_a["college_id"]),
        },
    )
    assert resp.status_code == 400


def test_whoami_ignores_invalid_jwt_and_falls_back_to_subdomain(client, two_colleges):
    """An unparseable/invalid bearer token is not itself an error at
    this layer (no route requires auth yet) — it just contributes no
    jwt_claim candidate, same as an absent header.
    """
    tenant_a, _ = two_colleges
    resp = client.get(
        "/api/v1/whoami",
        headers={
            "host": _host_for(tenant_a["subdomain"]),
            "authorization": "Bearer not-a-real-jwt",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["college_id"] == tenant_a["college_id"]


def test_whoami_returns_400_when_no_tenant_resolves(client):
    resp = client.get("/api/v1/whoami")
    assert resp.status_code == 400


def test_health_does_not_require_a_tenant(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200


def test_sequential_requests_for_different_tenants_dont_leak(client, two_colleges):
    """Middleware-level analogue of the RLS pooled-connection leak
    test: successive requests for alternating tenants, on an app whose
    DB engine pool may reuse physical connections underneath, must
    never see each other's tenant context.
    """
    tenant_a, tenant_b = two_colleges
    sequence = [tenant_a, tenant_b, tenant_a, tenant_b, tenant_b, tenant_a]
    for tenant in sequence:
        resp = client.get("/api/v1/whoami", headers={"host": _host_for(tenant["subdomain"])})
        assert resp.status_code == 200
        assert resp.json()["college_id"] == tenant["college_id"]
