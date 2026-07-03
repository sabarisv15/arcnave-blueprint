"""The Platform (Super Admin Portal) API — a genuinely separate ASGI
application, mounted at /api/v1/platform in main.py via app.mount(),
as a *peer* of app/tenant_app.py under the thin top-level app, not
nested inside the tenant app.

This is what makes the isolation real rather than a shared-middleware
special case (ADR-010, Architecture.md 2.1: "Never shares auth or
database access with tenant requests"). Note the peer structure is
load bearing: middleware added to main.py's top-level app would run
for every request regardless of which Mount serves it — Starlette's
Mount hands off routing to a sub-app, it does not exempt a path from
an ancestor's middleware. TenantMiddleware and AuthMiddleware live
only on tenant_app, never here and never on the top-level app, so
they never run for any /api/v1/platform/* request — verified, not
just asserted, in backend/tests/integration/test_platform.py's
isolation test (which failed against an earlier, single-app structure
before this file and main.py were split apart to actually fix it).

RequestContextMiddleware is the one exception: it's harmless (just
request_id + one access-log line) and there's no reason platform
requests shouldn't get the same observability as tenant ones.
"""
from fastapi import FastAPI

from app.api.platform.router import router as platform_router
from app.middleware.request_context import RequestContextMiddleware

platform_app = FastAPI(title="ARCNAVE Platform API")
platform_app.add_middleware(RequestContextMiddleware)
platform_app.include_router(platform_router)
