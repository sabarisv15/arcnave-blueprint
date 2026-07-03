"""The tenant-facing API — a genuinely separate ASGI application from
platform_app (app/platform_app.py), mounted at /api/v1 in main.py.
Owns the full tenant middleware stack; nothing platform-related runs
here, and nothing here runs for a platform-mounted request either —
see main.py's module docstring for why that requires living on its
own sub-app rather than just being routes on the top-level app.
"""
from fastapi import FastAPI

from app.api.v1.router import router as v1_router
from app.middleware.auth import AuthMiddleware
from app.middleware.request_context import RequestContextMiddleware
from app.middleware.tenant import TenantMiddleware

tenant_app = FastAPI(title="ARCNAVE Tenant API")
# Middleware added last runs first (Starlette wraps in reverse
# registration order). Order here: TenantMiddleware, then
# AuthMiddleware, then RequestContextMiddleware — so at request time
# it's RequestContextMiddleware -> AuthMiddleware -> TenantMiddleware
# -> route, matching Architecture.md 2.4's auth -> tenant resolution
# order with request_id generation wrapping both.
#
# "Request logging" per Architecture.md 2.4 is deliberately NOT a
# fourth phase spliced between tenant resolution and the transaction
# TenantMiddleware opens — doing that would mean splitting
# TenantMiddleware, which isn't worth the risk right now. Instead,
# RequestContextMiddleware generates request_id up front and logs one
# access-log line at the end; TenantMiddleware/AuthMiddleware each
# gained a one-line addition to update the same request-scoped context
# with tenant_id/user_id as soon as they resolve them — see
# app/core/request_context.py.
tenant_app.add_middleware(TenantMiddleware)
tenant_app.add_middleware(AuthMiddleware)
tenant_app.add_middleware(RequestContextMiddleware)
# No prefix here — main.py's app.mount("/api/v1", tenant_app) already
# supplies it; v1_router's own paths (/health, /auth/login, ...) are
# relative to that mount point.
tenant_app.include_router(v1_router)
