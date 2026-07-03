from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import request_context
from app.core.database import SessionLocal, set_tenant_context


class TenantMismatchError(Exception):
    """Two or more tenant-resolution sources disagree.

    Per Architecture.md's fail-closed principle, a mismatch is a
    reject, never a silent pick-one — e.g. a subdomain resolving to
    college A combined with an explicit college code for college B
    must not resolve to either.
    """

    def __init__(self, candidates: dict[str, str]) -> None:
        self.candidates = candidates
        super().__init__(f"Conflicting tenant resolution: {candidates}")


def _extract_subdomain(request: Request) -> str | None:
    host = request.headers.get("host", "")
    host = host.split(":", 1)[0]
    labels = host.split(".")
    if len(labels) < 2:
        # Bare host with no subdomain label (e.g. "localhost",
        # "testserver", "arcnave.com" itself) — not a tenant signal.
        return None
    candidate = labels[0].strip().lower()
    return candidate or None


def _extract_explicit_code(request: Request) -> str | None:
    code = request.headers.get("x-college-code")
    if code is None:
        return None
    code = code.strip()
    return code or None


def _lookup_college_id_by_subdomain(db: Session, subdomain: str) -> str | None:
    row = db.execute(
        text("SELECT college_id FROM colleges WHERE subdomain = :subdomain"),
        {"subdomain": subdomain},
    ).first()
    return row.college_id if row else None


def _lookup_college_id_by_code(db: Session, code: str) -> str | None:
    row = db.execute(
        text("SELECT college_id FROM colleges WHERE college_id = :code"),
        {"code": code},
    ).first()
    return row.college_id if row else None


def resolve_tenant(request: Request, db: Session) -> str | None:
    """Resolve college_id per Architecture.md 2.2's priority order:
    (1) subdomain, (2) JWT claim, (3) explicit college code.

    Every source that's present *and* resolves to a real college
    becomes a candidate. If more than one candidate disagrees, that's
    a TenantMismatchError — not a silent pick of the highest-priority
    one. A client presenting contradictory tenant signals is not a
    case "the first source wins" should paper over. Only once all
    present candidates agree (or only one is present) does priority
    order pick which value to return.

    An unresolvable or absent source (subdomain that isn't any
    college's, no header present) is simply not a candidate — it is
    not an error by itself. Whether a request without any resolved
    tenant is acceptable is a route's decision (e.g. /health doesn't
    need one; /whoami requires one), not this function's.
    """
    candidates: dict[str, str] = {}

    subdomain = _extract_subdomain(request)
    if subdomain:
        resolved = _lookup_college_id_by_subdomain(db, subdomain)
        if resolved:
            candidates["subdomain"] = resolved

    # request.state.jwt_claims is set by AuthMiddleware, which runs
    # before this one (see main.py's add_middleware ordering). An
    # invalid/expired/absent token already left it None there — that
    # is simply "this source didn't resolve," same as an unregistered
    # subdomain, not a separate error path here. The claimed
    # college_id still goes through the same DB existence check as
    # the explicit-code source below: a validly-signed JWT proves the
    # claim wasn't tampered with, not that the college it names still
    # exists.
    jwt_claims = request.state.jwt_claims
    if jwt_claims:
        claimed_college_id = jwt_claims.get("college_id")
        if claimed_college_id:
            resolved = _lookup_college_id_by_code(db, claimed_college_id)
            if resolved:
                candidates["jwt_claim"] = resolved

    code = _extract_explicit_code(request)
    if code:
        resolved = _lookup_college_id_by_code(db, code)
        if resolved:
            candidates["explicit_code"] = resolved

    if len(set(candidates.values())) > 1:
        raise TenantMismatchError(candidates)

    for source in ("subdomain", "jwt_claim", "explicit_code"):
        if source in candidates:
            return candidates[source]
    return None


class TenantMiddleware(BaseHTTPMiddleware):
    """Resolves the tenant and opens the per-request, tenant-scoped
    transaction before any route handler runs — Architecture.md 2.4's
    "tenant resolution" and "begin transaction / SET LOCAL" steps
    collapsed into one middleware, since the transaction can't be
    scoped to a tenant until the tenant is known.

    request.state.db carries the resulting session forward;
    app.core.database.get_db() yields it rather than opening a second
    session, so route handlers observe the same tenant-scoped
    transaction this middleware set up — not an unrelated one.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        resolution_db = SessionLocal()
        try:
            college_id = resolve_tenant(request, resolution_db)
        except TenantMismatchError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=400)
        finally:
            resolution_db.close()

        db = SessionLocal()
        request.state.db = db
        request.state.college_id = college_id
        request_context.set_tenant_id(college_id)
        try:
            if college_id is not None:
                set_tenant_context(db, college_id)
            response = await call_next(request)
            db.commit()
            return response
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
