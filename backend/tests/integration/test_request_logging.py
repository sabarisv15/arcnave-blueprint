"""Tests for request-scoped structured logging: RequestContextMiddleware
+ contextvar-based enrichment in JSONFormatter (app/core/request_context.py).

Captures real JSON text through the real JSONFormatter, via a
temporary handler attached to the root logger for the duration of
each test, rather than mocking anything or relying on pytest's
capsys/caplog — capsys wouldn't reliably see output from a
logging.StreamHandler constructed once at import time with a stale
sys.stdout reference, and caplog bypasses our formatter entirely. This
proves the actual JSON string our formatter renders, which is what
"the log line carries request_id" actually means.
"""
import json
import logging
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.core.logging import JSONFormatter
from app.core.security import create_access_token, hash_password
from app.main import app

settings = get_settings()


class _CapturingHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[dict] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(json.loads(self.format(record)))


@pytest.fixture
def captured_logs():
    handler = _CapturingHandler()
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        yield handler.records
    finally:
        root.removeHandler(handler)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _access_log_lines(records: list[dict]) -> list[dict]:
    return [r for r in records if r.get("message") == "request_completed"]


def test_request_completed_log_has_request_id_and_omits_unresolved_tenant(client, captured_logs):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200

    lines = _access_log_lines(captured_logs)
    assert len(lines) == 1
    line = lines[0]
    assert line["request_id"]
    assert line["method"] == "GET"
    assert line["path"] == "/api/v1/health"
    assert line["status"] == 200
    assert isinstance(line["duration_ms"], (int, float))
    # /health resolves no tenant and carries no JWT — those fields are
    # omitted entirely, not present-as-null (consistent with how
    # ambient context enrichment already omits unset fields).
    assert "tenant_id" not in line
    assert "user_id" not in line


def test_request_completed_log_carries_tenant_and_user_when_resolved(
    client, captured_logs, tenant_with_user
):
    """A JWT's college_id claim only becomes the *resolved* tenant_id
    once TenantMiddleware validates it against a real colleges row
    (same DB-existence check as the subdomain/explicit-code sources) —
    an arbitrary, never-seeded college_id in the token would correctly
    fail to resolve, same as an unregistered subdomain. So this needs
    a real seeded college, not a made-up college_id.
    """
    token = create_access_token(
        user_id="user-42", college_id=tenant_with_user["college_id"], role="staff"
    )
    resp = client.get("/api/v1/auth/me", headers={"authorization": f"Bearer {token}"})
    assert resp.status_code == 200

    lines = _access_log_lines(captured_logs)
    assert len(lines) == 1
    line = lines[0]
    assert line["request_id"]
    assert line["tenant_id"] == tenant_with_user["college_id"]
    assert line["user_id"] == "user-42"
    assert line["status"] == 200


def test_request_id_is_generated_and_echoed_on_response(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.headers.get("x-request-id")


def test_incoming_request_id_header_is_honored(client, captured_logs):
    resp = client.get("/api/v1/health", headers={"x-request-id": "trace-abc-123"})
    assert resp.status_code == 200
    assert resp.headers["x-request-id"] == "trace-abc-123"

    lines = _access_log_lines(captured_logs)
    assert lines[0]["request_id"] == "trace-abc-123"


def test_sequential_requests_get_different_request_ids(client):
    """Don't just trust that contextvars isolate correctly per
    request — prove it, the same way test_rls_tenant_isolation.py
    proves pooled-connection reuse instead of trusting the pool
    config. Same TestClient (same app/event loop) across several
    sequential requests.
    """
    ids = [client.get("/api/v1/health").headers["x-request-id"] for _ in range(5)]
    assert len(set(ids)) == len(ids)


@pytest.fixture
def tenant_with_user():
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    suffix = uuid.uuid4().hex[:8]
    college = {"college_id": f"reqlog{suffix}", "subdomain": f"reqlogtenant{suffix}"}

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
                "VALUES (:college_id, 'reqloguser', 'reqloguser@example.com', :password_hash, 'staff', true)"
            ),
            {"college_id": college["college_id"], "password_hash": hash_password("ReqLogPass123!")},
        )

    yield college

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


def test_log_lines_from_deep_in_the_stack_are_enriched_automatically(
    client, captured_logs, tenant_with_user
):
    """Not just RequestContextMiddleware's own access-log line — the
    actual point of contextvars here is that *any* log call made
    anywhere during request handling picks up request_id/tenant_id
    automatically. app/services/auth_service.py's existing
    refresh-token-reuse warning is a real, pre-existing call site that
    never touches a Request object at all; if request_id shows up on
    it, the contextvar mechanism put it there, not an explicit
    extra={} at that call site (contrast with college_id/user_id/
    refresh_token_id there, which ARE explicit extras).
    """
    headers = {"host": f"{tenant_with_user['subdomain']}.arcnave.test"}
    login = client.post(
        "/api/v1/auth/login",
        headers=headers,
        json={"username": "reqloguser", "password": "ReqLogPass123!"},
    )
    refresh_token = login.json()["refresh_token"]

    first = client.post("/api/v1/auth/refresh", headers=headers, json={"refresh_token": refresh_token})
    assert first.status_code == 200
    second = client.post("/api/v1/auth/refresh", headers=headers, json={"refresh_token": refresh_token})
    assert second.status_code == 401

    reuse_logs = [r for r in captured_logs if r.get("message") == "refresh_token_reuse_detected"]
    assert len(reuse_logs) == 1
    assert reuse_logs[0]["request_id"]
    assert reuse_logs[0]["college_id"] == tenant_with_user["college_id"]
