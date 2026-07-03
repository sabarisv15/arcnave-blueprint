from fastapi import APIRouter

from app.api.v1 import auth, configurations, health, whoami

router = APIRouter()
router.include_router(health.router, tags=["health"])
router.include_router(whoami.router, tags=["whoami"])
router.include_router(auth.router, tags=["auth"])
router.include_router(configurations.router, tags=["configurations"])
