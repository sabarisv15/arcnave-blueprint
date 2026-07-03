from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter()


@router.get("/whoami")
def whoami(db: Session = Depends(get_db)) -> dict:
    """Returns the tenant Postgres itself believes is active for this
    request's transaction.

    Deliberately reads current_setting() from the database rather
    than the middleware's Python-level resolved value — that's what
    proves the full resolve -> set_tenant_context() -> route-handler
    pipeline actually reaches the DB layer, not just that
    TenantMiddleware computed the right string in memory.
    """
    college_id = db.execute(
        text("SELECT current_setting('app.current_tenant', true)")
    ).scalar()
    if not college_id:
        raise HTTPException(status_code=400, detail="No tenant could be resolved for this request")
    return {"college_id": college_id}
