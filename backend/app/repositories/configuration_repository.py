"""Query mechanics for `configurations` only — no business logic (see
app/services/configuration_service.py for that). RLS-scoped tenant
table; every query here is implicitly filtered to whatever tenant
TenantMiddleware resolved for the current request. `college_id` is
still passed explicitly into every query below anyway — defense in
depth, same reasoning as auth_repository.py: RLS is the backstop, not
the only filter a reader of this file should have to trust.

`category` is never validated or enumerated here or in the service —
it's an opaque string, and `configuration` is opaque JSONB. Which
category names exist and what shape their JSON should have is a
decision for whichever module owns that category (Attendance,
Finance, Notifications, ...), not Module 0.
"""
import json

from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session


def get_configuration(db: Session, *, college_id: str, category: str) -> Row | None:
    return db.execute(
        text(
            "SELECT id, college_id, category, configuration, version, updated_at "
            "FROM configurations WHERE college_id = :college_id AND category = :category"
        ),
        {"college_id": college_id, "category": category},
    ).first()


def create_configuration(db: Session, *, college_id: str, category: str, configuration: dict) -> Row:
    """Always creates at version 1. Raises sqlalchemy.exc.IntegrityError
    (via the UNIQUE (college_id, category) constraint) if the category
    was created concurrently between the service's existence check and
    this call — the service translates that into
    ConfigurationVersionConflictError, the same error a stale
    expected_version produces, since both are the same kind of "someone
    else changed this first" conflict from the caller's point of view.
    """
    return db.execute(
        text(
            "INSERT INTO configurations (college_id, category, configuration, version) "
            "VALUES (:college_id, :category, :configuration, 1) "
            "RETURNING id, college_id, category, configuration, version, updated_at"
        ),
        {"college_id": college_id, "category": category, "configuration": json.dumps(configuration)},
    ).first()


def update_configuration(
    db: Session, *, college_id: str, category: str, configuration: dict, expected_version: int
) -> Row | None:
    """Optimistic concurrency, enforced atomically by the WHERE clause
    itself (not by the service's earlier read-then-decide check, which
    only exists to distinguish "doesn't exist" from "wrong version" for
    a clearer error and for the audit log's old_version). Returns None
    if no row matched — either the category doesn't exist, or the
    version moved between the service's read and this call. The
    service treats both as the same conflict.
    """
    return db.execute(
        text(
            "UPDATE configurations "
            "SET configuration = :configuration, version = version + 1, updated_at = now() "
            "WHERE college_id = :college_id AND category = :category AND version = :expected_version "
            "RETURNING id, college_id, category, configuration, version, updated_at"
        ),
        {
            "college_id": college_id,
            "category": category,
            "configuration": json.dumps(configuration),
            "expected_version": expected_version,
        },
    ).first()
