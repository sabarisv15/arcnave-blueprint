from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import TENANT_ROLES, require_role
from app.core.database import get_db
from app.schemas.auth import (
    LoginRequest,
    PasswordResetRequest,
    RefreshRequest,
    TokenResponse,
)
from app.services import auth_service

router = APIRouter()


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    college_id = request.state.college_id
    if college_id is None:
        raise HTTPException(status_code=400, detail="No tenant could be resolved for this request")
    try:
        tokens = auth_service.login(
            db, college_id=college_id, username=payload.username, password=payload.password
        )
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenResponse(access_token=tokens.access_token, refresh_token=tokens.refresh_token)


@router.post("/auth/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenResponse:
    try:
        tokens = auth_service.refresh(db, payload.refresh_token)
    except (auth_service.RefreshTokenReuseError, auth_service.AuthError):
        # Same client-facing outcome either way — the reuse case is
        # already distinguished server-side via the warning log
        # AuthService.refresh emits before raising.
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    return TokenResponse(access_token=tokens.access_token, refresh_token=tokens.refresh_token)


@router.post("/auth/logout", status_code=204)
def logout(payload: RefreshRequest, db: Session = Depends(get_db)) -> None:
    auth_service.revoke(db, payload.refresh_token)


@router.post("/auth/password-reset", status_code=501)
def password_reset(payload: PasswordResetRequest) -> None:
    try:
        auth_service.request_password_reset(payload.email)
    except NotImplementedError:
        raise HTTPException(status_code=501, detail="Password reset is not implemented yet")


@router.get("/auth/me")
def me(claims: dict = Depends(require_role(*TENANT_ROLES))) -> dict:
    """First real RBAC-gated route: any authenticated tenant user
    (staff/hod/principal) may call this, no route requires auth at
    all until this. Returns the resolved identity straight from the
    JWT's already-verified claims — no DB lookup needed, same
    reasoning as require_role itself.
    """
    return {
        "user_id": claims["sub"],
        "college_id": claims["college_id"],
        "role": claims["role"],
    }
