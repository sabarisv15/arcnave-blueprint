from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.platform_database import get_platform_db
from app.schemas.platform import PlatformLoginRequest, PlatformTokenResponse
from app.services import platform_service

router = APIRouter()


@router.post("/auth/login", response_model=PlatformTokenResponse)
def login(
    payload: PlatformLoginRequest, db: Session = Depends(get_platform_db)
) -> PlatformTokenResponse:
    """No refresh token issued — platform admins re-authenticate when
    their access token expires. See Module-00-Platform.md "Known
    Limitations" for why refresh rotation wasn't built speculatively
    for a role that doesn't need it yet.
    """
    try:
        token = platform_service.login(db, username=payload.username, password=payload.password)
    except platform_service.PlatformAuthError:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return PlatformTokenResponse(access_token=token.access_token)
