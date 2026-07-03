"""Business logic for the Super Admin Portal API: platform-admin
login, college creation, and principal invitation.

invite_principal is Option B from Module-00-Platform.md's Known
Limitations writeup: this module records an invitation row and hands
back a bearer token, but never writes to `users` itself — creating the
actual account happens on the tenant side (see
app/services/principal_invitation_service.py), through the normal
RLS-protected tenant request path. arcnave_platform has no GRANT on
`users`/`refresh_tokens`/`audit_log`/`configurations` (Module 0
migration) and gets none here either — only SELECT/INSERT/UPDATE on
the new `principal_invitations` table (0002 migration), so even a bug
in this file could not reach tenant data.
"""
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_platform_access_token, hash_refresh_token, verify_password
from app.repositories import platform_repository, principal_invitation_repository

settings = get_settings()


class PlatformAuthError(Exception):
    """Generic platform-admin authentication failure — same
    single-message-for-every-failure-mode reasoning as AuthError in
    auth_service.py: unknown username and wrong password must look
    identical to the caller.
    """


class DuplicateCollegeError(Exception):
    """college_id or subdomain already exists."""


class CollegeNotFoundError(Exception):
    """invite_principal's target college_id doesn't exist.

    Raised from the same IntegrityError catch as DuplicateCollegeError
    above uses for create_college: principal_invitations.college_id
    is a foreign key into colleges, so an unknown college_id fails at
    INSERT time as a constraint violation, not a separate existence
    check. There's exactly one FK on this table, so any IntegrityError
    here unambiguously means this.
    """


@dataclass
class PlatformToken:
    access_token: str
    token_type: str = "bearer"


@dataclass
class PrincipalInvitation:
    college_id: str
    email: str
    token: str
    expires_at: datetime


def login(db: Session, *, username: str, password: str) -> PlatformToken:
    admin = platform_repository.get_platform_admin_by_username(db, username)
    if admin is None or not verify_password(password, admin.password_hash):
        raise PlatformAuthError("Invalid username or password")
    access_token = create_platform_access_token(admin_id=str(admin.id))
    return PlatformToken(access_token=access_token)


def create_college(db: Session, *, college_id: str, name: str, subdomain: str, created_by: str) -> Row:
    try:
        college = platform_repository.create_college(
            db, college_id=college_id, name=name, subdomain=subdomain, created_by=created_by
        )
    except IntegrityError as exc:
        db.rollback()
        raise DuplicateCollegeError("college_id or subdomain already exists") from exc
    return college


def invite_principal(db: Session, *, college_id: str, email: str, created_by: str) -> PrincipalInvitation:
    """Records an invitation and returns the raw token — the API layer
    hands it back directly in the response body as a temporary stand-in
    for actually emailing an accept-link, since NotificationService
    doesn't exist yet (see Module-00-Platform.md Known Limitations,
    same pattern as password-reset's 501 stub). The raw token is never
    persisted — only its hash (hash_refresh_token, reused rather than
    duplicated: an invitation token has the same threat-model shape as
    a refresh token, server-generated high-entropy randomness, not a
    low-entropy secret needing argon2's deliberate slowness).
    """
    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.principal_invitation_expire_hours)
    try:
        invitation = principal_invitation_repository.create_invitation(
            db,
            college_id=college_id,
            email=email,
            token_hash=hash_refresh_token(raw_token),
            created_by=created_by,
            expires_at=expires_at,
        )
    except IntegrityError as exc:
        db.rollback()
        raise CollegeNotFoundError(f"No college with college_id {college_id!r}") from exc
    return PrincipalInvitation(
        college_id=invitation.college_id,
        email=invitation.email,
        token=raw_token,
        expires_at=invitation.expires_at,
    )
