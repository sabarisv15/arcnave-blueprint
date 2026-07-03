import json
import logging
import sys
from datetime import datetime, timezone

from app.core import request_context

# Attributes every LogRecord carries by default (per the stdlib
# logging docs) — anything else on the record came from a caller's
# `extra={...}` and belongs in the JSON payload. Used to distinguish
# "framework noise" from "the security/debugging detail someone
# actually logged" (e.g. AuthService's refresh-token-reuse signal).
_STANDARD_LOG_RECORD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "taskName", "message",
}


class JSONFormatter(logging.Formatter):
    """Structured JSON logs per Architecture.md's observability section.

    Every log line emitted during a request is automatically stamped
    with request_id/tenant_id/user_id, read from the contextvars in
    app.core.request_context — no call site has to pass them.
    Per-call `extra={...}` fields (e.g. AuthService's refresh-token-
    reuse signal) still work exactly as before and are applied last,
    so an explicit extra value wins over ambient context on the rare
    case both set the same key.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        context = {
            key: value for key, value in request_context.get_context().items() if value is not None
        }
        payload.update(context)
        extras = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _STANDARD_LOG_RECORD_ATTRS
            and not key.startswith("_")
            and value is not None
        }
        if extras:
            payload.update(extras)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def setup_logging(log_level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(log_level)
