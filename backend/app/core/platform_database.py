"""Platform DB session — a separate module from app/core/database.py
on purpose, not just a separate function in the same file. The whole
point of this pass is that the platform path and the tenant path
never share a connection, a role, or a session lifecycle; having the
import path itself read `from app.core.platform_database import
get_platform_db` (never `from app.core.database import get_db`) makes
that separation obvious at every call site, not just true at runtime.
"""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

platform_engine = create_engine(settings.platform_database_url, pool_pre_ping=True)
PlatformSessionLocal = sessionmaker(bind=platform_engine, autoflush=False, autocommit=False)


def get_platform_db() -> Generator[Session, None, None]:
    """Platform routes must use this, never app.core.database.get_db()
    — that one yields the tenant-scoped session TenantMiddleware opens
    (arcnave_app, RLS-affected), and the platform sub-app doesn't even
    run TenantMiddleware (see app/platform_app.py) to have one.

    Unlike the tenant path, platform_admins/colleges carry no RLS, so
    there's no SET LOCAL/set_config step to sequence around a
    middleware-opened transaction. This dependency owns the session's
    whole lifecycle itself: commit on success, rollback on exception,
    always close.
    """
    db = PlatformSessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
