"""Business logic for accepting a principal invitation — the tenant
side of Option B (see app/services/platform_service.py's invite_principal
and Module-00-Platform.md's Known Limitations for the two-option
writeup this resolves). Creates the very first `users` row for a
newly-provisioned college through the normal tenant write path: no
exception to arcnave_platform's zero grants on any tenant table, no
special-cased RLS bypass on the DB side — the one deliberate bypass
here is entirely in Python (see accept_invitation's set_tenant_context
call below), not in any grant or policy.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import set_tenant_context
from app.core.security import hash_password, hash_refresh_token
from app.repositories import auth_repository, principal_invitation_repository

logger = logging.getLogger(__name__)


class InvitationError(Exception):
    """Invalid, expired, or already-accepted invitation token.

    Deliberately one message for all three cases at the API boundary
    — same reasoning as AuthError in auth_service.py: telling a caller
    "expired" vs. "already used" vs. "never existed" would let them
    distinguish a real-but-stale token from a guessed one.
    """


class UsernameTakenError(Exception):
    """The requested username is already taken within this tenant
    (UNIQUE (college_id, username))."""


def accept_invitation(db: Session, *, raw_token: str, username: str, password: str) -> Row:
    token_hash = hash_refresh_token(raw_token)
    invitation = principal_invitation_repository.get_invitation_by_token_hash(db, token_hash)

    if invitation is None:
        raise InvitationError("Invalid or expired invitation")

    if invitation.accepted_at is not None:
        # Consistent with auth_service.refresh's refresh_token_reuse_detected:
        # presenting an already-used one-time credential again is a
        # signal worth logging, not just a routine rejection.
        logger.warning(
            "principal_invitation_reuse_detected",
            extra={
                "college_id": invitation.college_id,
                "invitation_id": str(invitation.id),
                "originally_accepted_at": invitation.accepted_at,
            },
        )
        raise InvitationError("Invalid or expired invitation")

    if invitation.expires_at <= datetime.now(timezone.utc):
        raise InvitationError("Invalid or expired invitation")

    # The one deliberate, narrow bypass of TenantMiddleware's normal
    # resolution in this codebase. request.state.college_id is None
    # here — this request has no subdomain/JWT/explicit-code signal at
    # all, by design (the caller has no account and no tenant context
    # yet; the invitation token itself is the only credential). The
    # invitation row's college_id, already proven authentic by the
    # token lookup above, is the one and only source of tenant scope
    # for the rest of this function. Every other route in this
    # codebase trusts request.state.college_id; this is the sole
    # exception, and it's a route deciding its own tenant scope rather
    # than any change to TenantMiddleware itself.
    set_tenant_context(db, invitation.college_id)

    try:
        user = auth_repository.create_user(
            db,
            college_id=invitation.college_id,
            username=username,
            email=invitation.email,
            password_hash=hash_password(password),
            role="principal",
            is_active=True,
        )
    except IntegrityError as exc:
        db.rollback()
        raise UsernameTakenError(f"Username {username!r} is already taken") from exc

    principal_invitation_repository.mark_invitation_accepted(db, str(invitation.id))
    return user
