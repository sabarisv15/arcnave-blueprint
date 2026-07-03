"""Business logic for the Super Admin Portal API: platform-admin login
and college creation only, this pass. Principal invitation is
explicitly not built yet — see docs/modules/Module-00-Platform.md
"Known Limitations" for why it's genuinely harder than it looks and
the two options being decided between.

This module only ever touches `platform_admins`/`colleges` — no path
to `users`/`refresh_tokens`/`audit_log`/`configurations` exists here,
and arcnave_platform has no GRANT on those tables regardless (Module 0
migration), so even a bug couldn't reach them.
"""
from dataclasses import dataclass

from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import create_platform_access_token, verify_password
from app.repositories import platform_repository


class PlatformAuthError(Exception):
    """Generic platform-admin authentication failure — same
    single-message-for-every-failure-mode reasoning as AuthError in
    auth_service.py: unknown username and wrong password must look
    identical to the caller.
    """


class DuplicateCollegeError(Exception):
    """college_id or subdomain already exists."""


@dataclass
class PlatformToken:
    access_token: str
    token_type: str = "bearer"


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
