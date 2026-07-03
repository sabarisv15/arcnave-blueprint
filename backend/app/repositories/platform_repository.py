"""Query mechanics for `platform_admins` and `colleges` only — the
Platform layer's two tables (ADR-010). Never `users`/`refresh_tokens`/
`audit_log`/`configurations`; arcnave_platform has no GRANT on those
regardless (see the Module 0 migration), so a query against them here
would fail at the DB level even if someone tried. No business logic
in this file — see app/services/platform_service.py for that.
"""
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session


def get_platform_admin_by_username(db: Session, username: str) -> Row | None:
    return db.execute(
        text(
            "SELECT id, username, email, password_hash "
            "FROM platform_admins WHERE username = :username"
        ),
        {"username": username},
    ).first()


def create_college(db: Session, *, college_id: str, name: str, subdomain: str, created_by: str) -> Row:
    return db.execute(
        text(
            "INSERT INTO colleges (college_id, name, subdomain, created_by) "
            "VALUES (:college_id, :name, :subdomain, :created_by) "
            "RETURNING id, college_id, name, subdomain, subscription_status, created_at"
        ),
        {
            "college_id": college_id,
            "name": name,
            "subdomain": subdomain,
            "created_by": created_by,
        },
    ).first()
