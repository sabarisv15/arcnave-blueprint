"""Pure unit tests for app/core/security.py — no database required."""
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.core.config import get_settings
from app.core.security import (
    TokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

settings = get_settings()

PASSWORD = "correct horse battery staple"


def test_hash_and_verify_password_round_trip():
    hashed = hash_password(PASSWORD)
    assert verify_password(PASSWORD, hashed)


def test_verify_password_rejects_wrong_password():
    hashed = hash_password(PASSWORD)
    assert not verify_password("wrong password", hashed)


def test_password_hash_is_not_the_plaintext():
    assert hash_password(PASSWORD) != PASSWORD


def test_create_and_decode_access_token_round_trip():
    token = create_access_token(user_id="user-1", college_id="college-1", role="staff")
    claims = decode_access_token(token)
    assert claims["sub"] == "user-1"
    assert claims["college_id"] == "college-1"
    assert claims["role"] == "staff"
    assert claims["type"] == "access"


def test_decode_rejects_expired_token():
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
    with pytest.raises(TokenError):
        decode_access_token(expired)


def test_decode_rejects_tampered_signature():
    token = create_access_token(user_id="user-1", college_id="college-1", role="staff")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(TokenError):
        decode_access_token(tampered)


def test_decode_rejects_token_signed_with_wrong_secret():
    forged = jwt.encode(
        {"sub": "user-1", "college_id": "college-1", "role": "staff"},
        "not-the-real-secret-but-long-enough-to-avoid-a-key-length-warning",
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(TokenError):
        decode_access_token(forged)


def test_decode_rejects_garbage():
    with pytest.raises(TokenError):
        decode_access_token("not-a-jwt-at-all")
