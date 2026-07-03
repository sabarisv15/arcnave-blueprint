"""Query mechanics for `principal_invitations` only — no business
logic (see app/services/platform_service.py for creation,
app/services/principal_invitation_service.py for acceptance).

Unlike every other repository in this codebase, functions here are
called from both sides of the platform/tenant split: create_invitation
runs against a platform-role session (arcnave_platform, via
get_platform_db), get_invitation_by_token_hash/mark_invitation_accepted
run against a tenant-role session (arcnave_app, via get_db). That's
safe because a SQLAlchemy Session here is just a connection handle —
which role's permissions actually apply is enforced by Postgres GRANT
on the connection itself (see the 0002 migration), not by anything in
this file. arcnave_app has no INSERT grant on this table, so
create_invitation would fail at the DB level if ever called with a
tenant-role session; that's a feature, not a gap this file needs to
guard against itself.
"""
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session


def create_invitation(
    db: Session, *, college_id: str, email: str, token_hash: str, created_by: str, expires_at: datetime
) -> Row:
    return db.execute(
        text(
            "INSERT INTO principal_invitations (college_id, email, token_hash, created_by, expires_at) "
            "VALUES (:college_id, :email, :token_hash, :created_by, :expires_at) "
            "RETURNING id, college_id, email, expires_at, created_at"
        ),
        {
            "college_id": college_id,
            "email": email,
            "token_hash": token_hash,
            "created_by": created_by,
            "expires_at": expires_at,
        },
    ).first()


def get_invitation_by_token_hash(db: Session, token_hash: str) -> Row | None:
    return db.execute(
        text(
            "SELECT id, college_id, email, expires_at, accepted_at "
            "FROM principal_invitations WHERE token_hash = :token_hash"
        ),
        {"token_hash": token_hash},
    ).first()


def mark_invitation_accepted(db: Session, invitation_id: str) -> None:
    db.execute(
        text("UPDATE principal_invitations SET accepted_at = now() WHERE id = :invitation_id"),
        {"invitation_id": invitation_id},
    )
