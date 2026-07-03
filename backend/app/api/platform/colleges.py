from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.platform.deps import require_platform_admin
from app.core.platform_database import get_platform_db
from app.schemas.platform import CollegeResponse, CreateCollegeRequest
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
