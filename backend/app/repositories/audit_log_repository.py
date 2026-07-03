"""Query mechanics for `audit_log` only — no business logic. A tiny,
separate file rather than bundled into whichever service first needed
it (ConfigurationService): audit_log is a cross-cutting, append-only
table every future service will eventually write to, not something
that belongs conceptually to configuration. arcnave_app has SELECT/
INSERT only on this table (no UPDATE/DELETE, by design — see the
Module 0 migration) — an audit trail the app role can rewrite or erase
isn't an audit trail, so create_audit_log_entry is the only write this
file offers.
"""
import json

from sqlalchemy import text
from sqlalchemy.orm import Session


def create_audit_log_entry(
    db: Session,
    *,
    college_id: str,
    user_id: str,
    action: str,
    entity: str,
    entity_id: str,
    metadata: dict,
) -> None:
    db.execute(
        text(
            "INSERT INTO audit_log (college_id, user_id, action, entity, entity_id, metadata) "
            "VALUES (:college_id, :user_id, :action, :entity, :entity_id, :metadata)"
        ),
        {
            "college_id": college_id,
            "user_id": user_id,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "metadata": json.dumps(metadata),
        },
    )
