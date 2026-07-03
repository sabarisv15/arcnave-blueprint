"""Business logic for the generic JSONB configuration store
(`configurations` table) — the mechanism only, not any category's
shape. Architecture.md eventually hangs attendance rules, fee
structure, SMTP/SMS, AI provider config, approval policies, branding,
and templates off this table, but those categories belong to whichever
module owns them (Attendance, Finance, Notifications, AI, ...), none of
which exist yet. This service never validates a category's internal
JSON shape or maintains a list of known category names — same
restraint as deferring the AI Tool Registry's shape to Module 9 rather
than guessing it now.
"""
from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.repositories import audit_log_repository, configuration_repository


class ConfigurationVersionConflictError(Exception):
    """Optimistic-concurrency conflict — never a silent overwrite.
    Covers three cases the caller doesn't need to distinguish: writing
    with a stale expected_version, writing with a non-None/non-zero
    expected_version against a category that doesn't exist yet, and
    the genuine race where two callers both see "doesn't exist" and
    both try to create it.
    """


def get_configuration(db: Session, *, college_id: str, category: str) -> Row | None:
    """None means the category has simply never been configured for
    this tenant — not an error. The route turns that into 404.
    """
    return configuration_repository.get_configuration(db, college_id=college_id, category=category)


def set_configuration(
    db: Session,
    *,
    college_id: str,
    category: str,
    configuration: dict,
    expected_version: int | None,
    user_id: str,
) -> Row:
    existing = configuration_repository.get_configuration(db, college_id=college_id, category=category)

    if existing is None:
        if expected_version not in (None, 0):
            raise ConfigurationVersionConflictError(
                f"category {category!r} does not exist yet; expected_version must be None or 0"
            )
        try:
            row = configuration_repository.create_configuration(
                db, college_id=college_id, category=category, configuration=configuration
            )
        except IntegrityError as exc:
            db.rollback()
            raise ConfigurationVersionConflictError(
                f"category {category!r} was created concurrently"
            ) from exc
        old_version = None
    else:
        if expected_version != existing.version:
            raise ConfigurationVersionConflictError(
                f"category {category!r} is at version {existing.version}, not {expected_version}"
            )
        row = configuration_repository.update_configuration(
            db,
            college_id=college_id,
            category=category,
            configuration=configuration,
            expected_version=expected_version,
        )
        if row is None:
            # The version moved between our read above and the UPDATE
            # itself — a genuine concurrent write, not just a stale
            # client. Same error either way; the caller doesn't need
            # to know which race they lost.
            raise ConfigurationVersionConflictError(f"category {category!r} was updated concurrently")
        old_version = existing.version

    audit_log_repository.create_audit_log_entry(
        db,
        college_id=college_id,
        user_id=user_id,
        action="configuration_updated",
        entity="configurations",
        entity_id=category,
        metadata={"old_version": old_version, "new_version": row.version},
    )
    return row
