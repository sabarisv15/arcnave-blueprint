"""Business logic for tenant-side authentication: login, refresh-token
rotation, revoke, and a not-implemented stub for password reset.

Platform Admin login (platform_admins table) is a deliberately
separate, not-yet-built concern — ADR-010 requires it never share
auth or DB access with the tenant path. This module only ever touches
`users`/`refresh_tokens`; it has no code path to `platform_admins`,
and arcnave_app has no GRANT on that table regardless (see the
Module 0 migration), so a tenant-scoped session couldn't read it even
if this module tried to.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    needs_rehash,
    verify_password,
)
from app.repositories import auth_repository

logger = logging.getLogger(__name__)
settings = get_settings()


class AuthError(Exception):
    """Generic authentication failure.

    Deliberately not more specific than this at the service boundary:
    unknown username, wrong password, and inactive account all raise
    the same thing, so the API layer can't accidentally return a
    response that reveals which of the three actually happened (that
    would leak which usernames exist / are pending activation).
    """


class RefreshTokenReuseError(Exception):
    """A refresh token that was already revoked was presented again.

    Distinct from AuthError even though the client-facing response is
    the same (401): this is a possible-theft signal, not a routine
    rejection, and AuthService.refresh logs it accordingly before
    raising.
    """


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


def _issue_token_pair(db: Session, *, college_id: str, user_id: str, role: str) -> TokenPair:
    access_token = create_access_token(user_id=user_id, college_id=college_id, role=role)
    refresh_token = generate_refresh_token()
    auth_repository.create_refresh_token(
        db,
        college_id=college_id,
        user_id=user_id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
    )
    return TokenPair(access_token=access_token, refresh_token=refresh_token)


def login(db: Session, *, college_id: str, username: str, password: str) -> TokenPair:
    user = auth_repository.get_user_by_username(db, college_id, username)
    if user is None or not verify_password(password, user.password_hash) or not user.is_active:
        raise AuthError("Invalid username or password")

    if needs_rehash(user.password_hash):
        auth_repository.update_password_hash(db, str(user.id), hash_password(password))

    return _issue_token_pair(db, college_id=user.college_id, user_id=str(user.id), role=user.role)


def refresh(db: Session, raw_refresh_token: str) -> TokenPair:
    token_hash = hash_refresh_token(raw_refresh_token)
    stored = auth_repository.get_refresh_token_by_hash(db, token_hash)

    if stored is None:
        raise AuthError("Invalid refresh token")

    if stored.revoked_at is not None:
        logger.warning(
            "refresh_token_reuse_detected",
            extra={
                "college_id": stored.college_id,
                "user_id": str(stored.user_id),
                "refresh_token_id": str(stored.id),
                "originally_revoked_at": stored.revoked_at,
            },
        )
        raise RefreshTokenReuseError("Refresh token was already revoked")

    if stored.expires_at <= datetime.now(timezone.utc):
        raise AuthError("Refresh token has expired")

    user = auth_repository.get_user_by_id(db, str(stored.user_id))
    if user is None or not user.is_active:
        raise AuthError("Account is not active")

    auth_repository.revoke_refresh_token(db, str(stored.id))
    return _issue_token_pair(db, college_id=user.college_id, user_id=str(user.id), role=user.role)


def revoke(db: Session, raw_refresh_token: str) -> None:
    """Logout. Idempotent and deliberately silent either way (no
    error for an unknown/already-revoked token) — the client's intent
    ("this token should stop working") is already satisfied.
    """
    token_hash = hash_refresh_token(raw_refresh_token)
    stored = auth_repository.get_refresh_token_by_hash(db, token_hash)
    if stored is not None and stored.revoked_at is None:
        auth_repository.revoke_refresh_token(db, str(stored.id))


def request_password_reset(email: str) -> None:
    """Stub — Roadmap.md lists password reset in Module 0 scope, but
    it needs NotificationService (email dispatch) and a reset-token
    flow neither of which exist yet. Raising here is the whole
    implementation; the API layer turns this into 501.
    """
    raise NotImplementedError("Password reset is not implemented in Module 0")
