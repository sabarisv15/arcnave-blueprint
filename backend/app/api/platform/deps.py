"""Platform sub-app dependencies — structurally separate from
app/api/deps.py's require_role, not a variant of it.

Unifying these was considered and rejected: a tenant access token and
a platform access token have deliberately different claim shapes (one
has college_id/role and type: "access"; the other has neither and
type: "platform_access"), signed with different secrets
(jwt_secret_key vs. platform_jwt_secret_key). A single "check role,
maybe check type" dependency shared between both would be one
`if`-branch away from accidentally accepting the wrong token type —
keeping two small, independent dependencies makes that class of bug
impossible to introduce by editing the wrong branch, not just unlikely.
"""
from fastapi import HTTPException, Request

from app.core.security import TokenError, decode_platform_access_token


def require_platform_admin(request: Request) -> dict:
    """Decodes the bearer token itself, unlike require_role — the
    platform sub-app never runs AuthMiddleware (see app/platform_app.py),
    so there is no upstream middleware that already did this.
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = auth_header[len("bearer "):].strip()
    try:
        claims = decode_platform_access_token(token)
    except TokenError:
        raise HTTPException(status_code=401, detail="Authentication required")

    if claims.get("type") != "platform_access":
        raise HTTPException(status_code=401, detail="Authentication required")

    return claims
