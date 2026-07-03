"""Integration tests for principal invitation — Option B (invite-
record-now, create-user-later) from Module-00-Platform.md's Known
Limitations writeup.

Four things this suite has to prove, not assume:
1. Only a platform admin can create an invitation.
2. Accepting a valid invitation creates a *correctly tenant-scoped*
   user — verified via RLS itself (arcnave_app, set_config'd to each
   college in turn), same discipline as test_rls_tenant_isolation.py,
   not just trusted from the response body looking right.
3. Expired and already-accepted tokens are rejected; reuse of an
   already-accepted token is logged, same pattern as
   auth_service.refresh's refresh_token_reuse_detected.
4. One college's invitation can never result in a user appearing under
   a different college_id — exercised with two colleges sharing the
   same requested username, which would collide if invitation A's
   college_id ever leaked into invitation B's accept flow.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.core.security import hash_password, hash_refresh_token
from app.main import app

settings = get_settings()

PLATFORM_PASSWORD = "PlatformPass123!"
ACCEPT_PASSWORD = "AcceptedPass123!"


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def platform_admin():
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    suffix = uuid.uuid4().hex[:8]
    username = f"invplatadmin{suffix}"

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
def two_colleges():
    """Two colleges, deliberately seeded with no users at all — this
    is exactly the "before the very first principal exists" state
    principal invitation exists to bootstrap out of.
    """
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    suffix = uuid.uuid4().hex[:8]
    college_a = f"inva{suffix}"
    college_b = f"invb{suffix}"

    with admin_engine.begin() as conn:
        for cid in (college_a, college_b):
            conn.execute(
                text("INSERT INTO colleges (college_id, name, subdomain) VALUES (:cid, :cid, :cid)"),
                {"cid": cid},
            )

    yield college_a, college_b

    with admin_engine.begin() as conn:
        for cid in (college_a, college_b):
            conn.execute(text("DELETE FROM principal_invitations WHERE college_id = :cid"), {"cid": cid})
            conn.execute(text("DELETE FROM refresh_tokens WHERE college_id = :cid"), {"cid": cid})
            conn.execute(text("DELETE FROM users WHERE college_id = :cid"), {"cid": cid})
            conn.execute(text("DELETE FROM colleges WHERE college_id = :cid"), {"cid": cid})
    admin_engine.dispose()


def _invite(client, platform_token, college_id, email):
    return client.post(
        f"/api/v1/platform/colleges/{college_id}/invite-principal",
        headers={"authorization": f"Bearer {platform_token}"},
        json={"email": email},
    )


def _accept(client, token, username, password=ACCEPT_PASSWORD):
    return client.post(
        "/api/v1/invitations/accept",
        json={"token": token, "username": username, "password": password},
    )


def _user_visible_under_tenant(college_id_for_context: str, username: str) -> bool:
    """Queries as arcnave_app with app.current_tenant explicitly
    set_config'd — the actual role/mechanism RLS constrains, not the
    migration-owner connection. Mirrors
    test_rls_tenant_isolation.py's approach exactly.
    """
    engine = create_engine(settings.database_url)
    try:
        with engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.current_tenant', :cid, true)"),
                {"cid": college_id_for_context},
            )
            row = conn.execute(
                text("SELECT 1 FROM users WHERE username = :username"), {"username": username}
            ).first()
            return row is not None
    finally:
        engine.dispose()


# --- Invitation creation (platform side) ---


def test_invite_principal_requires_platform_admin_token(client, two_colleges):
    college_a, _ = two_colleges
    resp = _invite(client, "not-a-real-token", college_a, "principal@example.com")
    assert resp.status_code == 401


def test_invite_principal_succeeds(client, platform_token, two_colleges):
    college_a, _ = two_colleges
    resp = _invite(client, platform_token, college_a, "principal@example.com")
    assert resp.status_code == 200
    body = resp.json()
    assert body["college_id"] == college_a
    assert body["email"] == "principal@example.com"
    assert body["token"]


def test_invite_principal_rejects_unknown_college(client, platform_token):
    resp = _invite(client, platform_token, "no-such-college", "principal@example.com")
    assert resp.status_code == 404


# --- Accepting an invitation (tenant side) ---


def test_accept_invitation_creates_correctly_tenant_scoped_user(client, platform_token, two_colleges):
    college_a, college_b = two_colleges
    token = _invite(client, platform_token, college_a, "principal@example.com").json()["token"]

    username = f"accepted{uuid.uuid4().hex[:8]}"
    resp = _accept(client, token, username)
    assert resp.status_code == 201
    body = resp.json()
    assert body["college_id"] == college_a
    assert body["username"] == username
    assert body["role"] == "principal"

    # The real check: not the response body, the database's own RLS
    # filtering, exactly as arcnave_app (the runtime role) would see
    # it on any other request.
    assert _user_visible_under_tenant(college_a, username) is True
    assert _user_visible_under_tenant(college_b, username) is False

    # And the created account actually works through the ordinary
    # tenant login path — proof this isn't just a row that happens to
    # look right.
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    with admin_engine.begin() as conn:
        subdomain = conn.execute(
            text("SELECT subdomain FROM colleges WHERE college_id = :cid"), {"cid": college_a}
        ).scalar()
    admin_engine.dispose()
    login_resp = client.post(
        "/api/v1/auth/login",
        headers={"host": f"{subdomain}.arcnave.test"},
        json={"username": username, "password": ACCEPT_PASSWORD},
    )
    assert login_resp.status_code == 200


def test_accept_invitation_rejects_expired_token(client, two_colleges):
    college_a, _ = two_colleges
    raw_token = f"expired-{uuid.uuid4().hex}"
    admin_engine = create_engine(settings.resolved_alembic_database_url)
    with admin_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO principal_invitations (college_id, email, token_hash, expires_at) "
                "VALUES (:cid, 'expired@example.com', :token_hash, :expires_at)"
            ),
            {
                "cid": college_a,
                "token_hash": hash_refresh_token(raw_token),
                "expires_at": datetime.now(timezone.utc) - timedelta(hours=1),
            },
        )
    admin_engine.dispose()

    resp = _accept(client, raw_token, f"shouldnotexist{uuid.uuid4().hex[:8]}")
    assert resp.status_code == 401


def test_accept_invitation_rejects_and_logs_reuse_of_accepted_token(
    client, platform_token, two_colleges, caplog
):
    college_a, _ = two_colleges
    token = _invite(client, platform_token, college_a, "principal@example.com").json()["token"]
    username = f"accepted{uuid.uuid4().hex[:8]}"

    first = _accept(client, token, username)
    assert first.status_code == 201

    with caplog.at_level("WARNING"):
        second = _accept(client, token, f"different{uuid.uuid4().hex[:8]}")
    assert second.status_code == 401
    assert any(
        "principal_invitation_reuse_detected" in record.getMessage() for record in caplog.records
    )


def test_accept_invitation_rejects_unknown_token(client):
    resp = _accept(client, "not-a-real-invitation-token", f"nouser{uuid.uuid4().hex[:8]}")
    assert resp.status_code == 401


# --- Cross-tenant isolation ---


def test_invitation_cannot_create_user_under_a_different_college(client, platform_token, two_colleges):
    """Two colleges, two invitations, the *same* requested username —
    if invitation A's college_id ever leaked into invitation B's
    accept flow (or vice versa), the second accept would either 409 on
    the shared (college_id, username) uniqueness constraint or, worse,
    silently create the second principal under the wrong college. Same
    "prove it with a shared name, not distinct ones" approach as
    test_configuration.py's cross-tenant test.
    """
    college_a, college_b = two_colleges
    token_a = _invite(client, platform_token, college_a, "principal-a@example.com").json()["token"]
    token_b = _invite(client, platform_token, college_b, "principal-b@example.com").json()["token"]

    shared_username = f"sharedprincipal{uuid.uuid4().hex[:8]}"

    resp_a = _accept(client, token_a, shared_username)
    resp_b = _accept(client, token_b, shared_username)
    assert resp_a.status_code == 201
    assert resp_b.status_code == 201
    assert resp_a.json()["college_id"] == college_a
    assert resp_b.json()["college_id"] == college_b

    # RLS-scoped proof each row landed under its own college, not the
    # other one.
    engine = create_engine(settings.database_url)
    try:
        with engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.current_tenant', :cid, true)"), {"cid": college_a})
            row = conn.execute(
                text("SELECT college_id FROM users WHERE username = :u"), {"u": shared_username}
            ).first()
            assert row is not None
            assert row.college_id == college_a

        with engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.current_tenant', :cid, true)"), {"cid": college_b})
            row = conn.execute(
                text("SELECT college_id FROM users WHERE username = :u"), {"u": shared_username}
            ).first()
            assert row is not None
            assert row.college_id == college_b
    finally:
        engine.dispose()
