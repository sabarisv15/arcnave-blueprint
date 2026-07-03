import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import get_settings

settings = get_settings()
_password_hasher = PasswordHasher()


class TokenError(Exception):
    """Any invalid/expired/malformed/mis-signed access JWT.

    Deliberately one exception type wrapping PyJWT's whole exception
    hierarchy, so callers (AuthMiddleware, tests) don't need to know
    which specific PyJWT error means what — an untrustworthy token is
    an untrustworthy token regardless of why.
    """


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False
    return True


def needs_rehash(password_hash: str) -> bool:
    """True if password_hash was hashed with older/weaker parameters
    than argon2-cffi's current defaults — checked and upgraded
    opportunistically on successful login in AuthService.login.
    """
    return _password_hasher.check_needs_rehash(password_hash)


def create_access_token(*, user_id: str, college_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "college_id": college_id,
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc


def create_platform_access_token(*, admin_id: str) -> str:
    """Platform-admin token. Signed with platform_jwt_secret_key — a
    different key from create_access_token's jwt_secret_key — and
    carries no college_id or role claim at all, only type:
    "platform_access". Structurally, not just by convention, this
    can't be confused with a tenant access token: even reading the
    claims of a successfully-decoded platform token gives you nothing
    that looks like a tenant claim shape. See app/api/platform/deps.py
    (require_platform_admin) and app/api/deps.py (require_role) — kept
    deliberately separate rather than unified.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": admin_id,
        "type": "platform_access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.platform_jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_platform_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token, settings.platform_jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    """SHA-256, not argon2, is deliberate here: a refresh token is
    already ~256 bits of server-generated randomness, not a low-
    entropy human-chosen secret. Hashing it protects against a DB-read
    compromise handing out directly-usable tokens; it isn't defending
    against brute-force guessing the way a password hash has to, so
    argon2's deliberate slowness buys nothing here and only costs
    latency on every refresh.
    """
    return hashlib.sha256(token.encode()).hexdigest()
