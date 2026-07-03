from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import TENANT_ROLES, require_role
from app.core.database import get_db
from app.schemas.configuration import ConfigurationResponse, SetConfigurationRequest
from app.services import configuration_service

router = APIRouter()


def _require_resolved_tenant(request: Request) -> str:
    college_id = request.state.college_id
    if college_id is None:
        raise HTTPException(status_code=400, detail="No tenant could be resolved for this request")
    return college_id


@router.get("/configurations/{category}", response_model=ConfigurationResponse)
def get_configuration(
    category: str,
    request: Request,
    claims: dict = Depends(require_role(*TENANT_ROLES)),
    db: Session = Depends(get_db),
) -> ConfigurationResponse:
    college_id = _require_resolved_tenant(request)
    row = configuration_service.get_configuration(db, college_id=college_id, category=category)
    if row is None:
        raise HTTPException(status_code=404, detail=f"No configuration set for category {category!r}")
    return ConfigurationResponse(category=row.category, configuration=row.configuration, version=row.version)


@router.put("/configurations/{category}", response_model=ConfigurationResponse)
def set_configuration(
    category: str,
    payload: SetConfigurationRequest,
    request: Request,
    # Conservative default, not a settled decision: BusinessRules.md
    # doesn't yet say who can change configuration — that's decided
    # per-category by whichever module owns it (e.g. fee structure
    # changes might reasonably need HOD, not just principal). Until a
    # real category exists with a real answer, restrict to the most
    # privileged known role rather than guess broader access is safe.
    claims: dict = Depends(require_role("principal")),
    db: Session = Depends(get_db),
) -> ConfigurationResponse:
    college_id = _require_resolved_tenant(request)
    try:
        row = configuration_service.set_configuration(
            db,
            college_id=college_id,
            category=category,
            configuration=payload.configuration,
            expected_version=payload.expected_version,
            user_id=claims["sub"],
        )
    except configuration_service.ConfigurationVersionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return ConfigurationResponse(category=row.category, configuration=row.configuration, version=row.version)
