import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core import request_context

logger = logging.getLogger(__name__)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Outermost middleware (added last in main.py, so it runs first).
    Owns request_id generation and the one guaranteed structured
    access-log line per request.

    Deliberately not a fourth "request logging" phase spliced between
    tenant resolution and the transaction TenantMiddleware opens, per
    Architecture.md 2.4's literal ordering — main.py already flags that
    doing so would mean splitting TenantMiddleware, which isn't worth
    the risk right now. This middleware only generates request_id
    up front and logs once at the end; TenantMiddleware/AuthMiddleware
    each gained a one-line addition to update the same context with
    tenant_id/user_id as soon as they resolve them.

    request_id is set via contextvar *before* calling further into the
    stack, so it — and, once TenantMiddleware/AuthMiddleware run,
    tenant_id/user_id too — are visible to every log call made
    anywhere during this request without that code needing a Request
    object at all. That forward direction (set before descending) is
    safe regardless of how many task boundaries the ASGI stack
    introduces beneath this middleware.

    The one thing that direction can't give us is this middleware
    reading tenant_id/user_id back out *after* call_next() returns for
    its own access-log line — an inner layer's contextvar mutation is
    not guaranteed to propagate back to an outer layer's task once the
    inner call completes. So this log line reads tenant_id/user_id
    from request.state instead (set by the same middlewares on the one
    Request object every layer shares by reference, unaffected by that
    task-boundary direction) rather than trusting the contextvar here.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request_context.set_request_id(request_id)

        start = time.monotonic()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            duration_ms = round((time.monotonic() - start) * 1000, 2)
            jwt_claims = getattr(request.state, "jwt_claims", None)
            logger.info(
                "request_completed",
                extra={
                    "request_id": request_id,
                    "tenant_id": getattr(request.state, "college_id", None),
                    "user_id": (jwt_claims or {}).get("sub"),
                    "method": request.method,
                    "path": request.url.path,
                    "status": status_code,
                    "duration_ms": duration_ms,
                },
            )
