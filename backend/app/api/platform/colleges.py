from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.platform.deps import require_platform_admin
from app.core.platform_database import get_platform_db
from app.schemas.platform import (
    CollegeResponse,
    CreateCollegeRequest,
    InvitePrincipalRequest,
    InvitePrincipalResponse,
)
from app.services import platform_service

router = APIRouter()


@router.post("/colleges", response_model=CollegeResponse, status_code=201)
def create_college(
    payload: CreateCollegeRequest,
    claims: dict = Depends(require_platform_admin),
    db: Session = Depends(get_platform_db),
) -> CollegeResponse:
    try:
        college = platform_service.create_college(
            db,
            college_id=payload.college_id,
            name=payload.name,
            subdomain=payload.subdomain,
            created_by=claims["sub"],
        )
    except platform_service.DuplicateCollegeError:
        raise HTTPException(status_code=409, detail="college_id or subdomain already exists")
    return CollegeResponse(
        college_id=college.college_id,
        name=college.name,
        subdomain=college.subdomain,
        subscription_status=college.subscription_status,
    )


@router.post("/colleges/{college_id}/invite-principal", response_model=InvitePrincipalResponse)
def invite_principal(
    college_id: str,
    payload: InvitePrincipalRequest,
    claims: dict = Depends(require_platform_admin),
    db: Session = Depends(get_platform_db),
) -> InvitePrincipalResponse:
    try:
        invitation = platform_service.invite_principal(
            db, college_id=college_id, email=payload.email, created_by=claims["sub"]
        )
    except platform_service.CollegeNotFoundError:
        raise HTTPException(status_code=404, detail=f"No college with college_id {college_id!r}")
    return InvitePrincipalResponse(
        college_id=invitation.college_id,
        email=invitation.email,
        token=invitation.token,
        expires_at=invitation.expires_at,
    )
