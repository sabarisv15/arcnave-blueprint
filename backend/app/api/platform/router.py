from fastapi import APIRouter

from app.api.platform import auth, colleges

router = APIRouter()
router.include_router(auth.router, tags=["platform-auth"])
router.include_router(colleges.router, tags=["platform-colleges"])
