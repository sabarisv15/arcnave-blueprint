"""Query mechanics for `users` and `refresh_tokens` only — no business
logic (see app/services/auth_service.py for that). Both tables are
RLS-scoped tenant tables; every query here is implicitly filtered to
whatever tenant TenantMiddleware resolved for the current request,
same as any other query run through the request-scoped session.
"""
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session


def create_user(
    db: Session, *, college_id: str, username: str, email: str, password_hash: str, role: str, is_active: bool
) -> Row:
    return db.execute(
        text(
            "INSERT INTO users (college_id, username, email, password_hash, role, is_active) "
            "VALUES (:college_id, :username, :email, :password_hash, :role, :is_active) "
            "RETURNING id, college_id, username, email, role, is_active"
        ),
        {
            "college_id": college_id,
            "username": username,
            "email": email,
            "password_hash": password_hash,
            "role": role,
            "is_active": is_active,
        },
    ).first()


def get_user_by_username(db: Session, college_id: str, username: str) -> Row | None:
    return db.execute(
        text(
            "SELECT id, college_id, username, password_hash, role, is_active "
            "FROM users WHERE college_id = :college_id AND username = :username"
        ),
        {"college_id": college_id, "username": username},
    ).first()


def get_user_by_id(db: Session, user_id: str) -> Row | None:
    return db.execute(
        text(
            "SELECT id, college_id, username, password_hash, role, is_active "
            "FROM users WHERE id = :user_id"
        ),
        {"user_id": user_id},
    ).first()


def update_password_hash(db: Session, user_id: str, password_hash: str) -> None:
    db.execute(
        text("UPDATE users SET password_hash = :password_hash WHERE id = :user_id"),
        {"password_hash": password_hash, "user_id": user_id},
    )


def create_refresh_token(
    db: Session, *, college_id: str, user_id: str, token_hash: str, expires_at: datetime
) -> None:
    db.execute(
        text(
            "INSERT INTO refresh_tokens (college_id, user_id, token_hash, expires_at) "
            "VALUES (:college_id, :user_id, :token_hash, :expires_at)"
        ),
        {
            "college_id": college_id,
            "user_id": user_id,
            "token_hash": token_hash,
            "expires_at": expires_at,
        },
    )


def get_refresh_token_by_hash(db: Session, token_hash: str) -> Row | None:
    return db.execute(
        text(
            "SELECT id, college_id, user_id, token_hash, issued_at, expires_at, revoked_at "
            "FROM refresh_tokens WHERE token_hash = :token_hash"
        ),
        {"token_hash": token_hash},
    ).first()


def revoke_refresh_token(db: Session, token_id: str) -> None:
    db.execute(
        text("UPDATE refresh_tokens SET revoked_at = now() WHERE id = :token_id"),
        {"token_id": token_id},
    )
