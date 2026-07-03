"""POST /invitations/accept — deliberately unauthenticated, and the
only tenant-side route in this codebase that doesn't rely on
TenantMiddleware's normal resolution for the tenant scope it operates
under.

No require_role dependency: the caller has no `users` row and
therefore no access token yet — the invitation token itself is the
one-time credential proving they should be allowed to create one.
request.state.college_id will be None for essentially every real call
here (no subdomain/JWT/explicit-code signal from someone who's never
had an account on this system) — that's expected, not an error, and
this route doesn't read request.state.college_id at all.
principal_invitation_service.accept_invitation resolves tenant scope
itself, from the invitation row's own college_id, once it has proven
the token is genuine. See that function's docstring for the full
reasoning.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.invitation import AcceptInvitationRequest, AcceptInvitationResponse
from app.services import principal_invitation_service

router = APIRouter()


@router.post("/invitations/accept", response_model=AcceptInvitationResponse, status_code=201)
def accept_invitation(payload: AcceptInvitationRequest, db: Session = Depends(get_db)) -> AcceptInvitationResponse:
    try:
        user = principal_invitation_service.accept_invitation(
            db, raw_token=payload.token, username=payload.username, password=payload.password
        )
    except principal_invitation_service.InvitationError:
        raise HTTPException(status_code=401, detail="Invalid or expired invitation")
    except principal_invitation_service.UsernameTakenError:
        raise HTTPException(status_code=409, detail=f"Username {payload.username!r} is already taken")
    return AcceptInvitationResponse(
        user_id=str(user.id),
        college_id=user.college_id,
        username=user.username,
        role=user.role,
    )
