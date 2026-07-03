from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from starlette.requests import Request

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db(request: Request) -> Generator[Session, None, None]:
    """Yields the session TenantMiddleware already opened for this
    request (request.state.db), not a fresh one.

    A route depending on this must run behind TenantMiddleware — which
    is every route, since it's mounted app-wide in main.py. Lifecycle
    (commit/rollback/close) is owned by the middleware, not here: this
    dependency's job is only to hand the same tenant-scoped transaction
    to route handlers, never to open a second, unscoped one.
    """
    yield request.state.db


def set_tenant_context(db: Session, college_id: str) -> None:
    """Scope the current transaction to one tenant.

    Uses set_config(..., is_local=True) rather than `SET LOCAL
    app.current_tenant = '<value>'` because SET does not accept bind
    parameters — string-building the value into SQL would reopen the
    injection risk RLS is supposed to close. set_config is the
    parameterized equivalent and has identical transaction-local
    semantics (resets automatically when the transaction ends, safe
    on pooled connections). Must be called inside the same
    transaction as the queries it protects — this is what the future
    Tenant Middleware calls per request, not a one-time setup step.
    """
    db.execute(
        text("SELECT set_config('app.current_tenant', :college_id, true)"),
        {"college_id": college_id},
    )
