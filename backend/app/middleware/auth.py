from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core import request_context
from app.core.security import TokenError, decode_access_token


class AuthMiddleware(BaseHTTPMiddleware):
    """Decodes a bearer access JWT if present and attaches its claims
    to request.state.jwt_claims — informational only at this stage.

    Does not reject requests for a missing/invalid/expired token:
    per-route "this requires auth" enforcement is RBAC, explicitly out
    of scope until the next module (see Module-00-Platform.md). An
    absent or untrustworthy token simply means no jwt_claims get
    attached — TenantMiddleware.resolve_tenant() already treats "this
    source didn't resolve" as normal, not an error, unless it
    conflicts with a source that did resolve.

    Must run before TenantMiddleware (see main.py's add_middleware
    ordering) since resolve_tenant() reads request.state.jwt_claims.

    Also updates request_context's user_id contextvar as soon as a
    token decodes successfully, so every log line for the rest of
    this request is automatically stamped with it — see
    app/core/request_context.py.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.jwt_claims = None
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[len("bearer "):].strip()
            try:
                request.state.jwt_claims = decode_access_token(token)
            except TokenError:
                pass
        if request.state.jwt_claims:
            request_context.set_user_id(request.state.jwt_claims.get("sub"))
        return await call_next(request)
