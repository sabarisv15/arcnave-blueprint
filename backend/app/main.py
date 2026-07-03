"""Top-level ASGI application. Deliberately thin: no business
middleware lives directly on this app.

TenantMiddleware/AuthMiddleware/RequestContextMiddleware used to be
added straight to this app, with platform_app mounted alongside as a
second route. That looked like isolation but wasn't: Starlette's
middleware wraps the *entire* ASGI callable before routing/mounting
decisions ever happen, so middleware on an outer app runs for every
request regardless of which Mount ultimately serves it — proven by
backend/tests/integration/test_platform.py's isolation test, which
failed against that structure (request.state.college_id/jwt_claims
existed on platform-mounted requests) before this file was restructured
to fix it, not just to make the test pass.

The actual fix: two independent sub-apps, each owning its own
middleware stack, with nothing of substance on the app mounting them.
- app/tenant_app.py — TenantMiddleware, AuthMiddleware,
  RequestContextMiddleware, mounted at /api/v1.
- app/platform_app.py — RequestContextMiddleware only, mounted at
  /api/v1/platform.

Mount order matters and is easy to get backwards: /api/v1/platform
must be registered before /api/v1, since Starlette's router matches
Mounts by path prefix in registration order and stops at the first
match. If /api/v1 were registered first, every /api/v1/platform/*
request would match it (a prefix match) before ever reaching the more
specific /api/v1/platform entry.
"""
from fastapi import FastAPI

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.platform_app import platform_app
from app.tenant_app import tenant_app

settings = get_settings()
setup_logging(settings.log_level)

app = FastAPI(title=settings.app_name)
app.mount("/api/v1/platform", platform_app)
app.mount("/api/v1", tenant_app)
