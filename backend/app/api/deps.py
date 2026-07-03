"""Shared FastAPI route dependencies."""
from fastapi import HTTPException, Request

# The three tenant-scoped roles Module 0's schema knows about
# (users.role). platform_admin is deliberately not here — it belongs
# to the not-yet-built Platform API's own auth (ADR-010), never the
# tenant-scoped request path this dependency is wired into.
TENANT_ROLES = ("staff", "hod", "principal")


def require_role(*roles: str):
    """FastAPI dependency factory gating a route to a set of roles.

    No DB lookup: role is a claim already embedded in the access
    token at login (app/core/security.py::create_access_token).
    Trusting it here means trusting the token's signature —
    AuthMiddleware already verified that before this dependency ever
    runs, and left request.state.jwt_claims as None for anything that
    didn't verify (missing, malformed, expired, tampered).

    401 vs. 403 is deliberate: no claims at all means the caller isn't
    authenticated (401); claims present but the wrong role means they
    are authenticated but not authorized for this route (403).

    Does not decide *which* roles should exist or who counts as
    "Class Tutor" vs. a hypothetical "College Admin" —
    BusinessRules.md leaves that role-model question explicitly open
    for Module 2. This dependency only enforces membership in
    whatever role set a route asks for.

    Checks claims.get("type") == "access" explicitly, not just
    "role" — belt-and-suspenders against a platform-admin token ever
    working here even if platform_jwt_secret_key and jwt_secret_key
    were accidentally set to the same value later (see
    app/api/platform/deps.py's require_platform_admin for the
    matching check in the other direction). A platform token has no
    role claim at all, so it would already fail the role check below
    even without this — but being explicit here means that's not the
    only thing standing between the two token types.
    """

    def dependency(request: Request) -> dict:
        claims = request.state.jwt_claims
        if claims is None or claims.get("type") != "access":
            raise HTTPException(status_code=401, detail="Authentication required")
        if claims.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return claims

    return dependency
