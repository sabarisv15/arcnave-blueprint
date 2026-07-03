"""Request-scoped log enrichment via contextvars — deliberately not
thread-locals, which don't propagate correctly across await boundaries
under FastAPI's async model (a thread-local is shared by every
coroutine running on the same OS thread, which is wrong the moment two
requests interleave on one event loop; a contextvar is scoped to the
current task/coroutine chain instead).

Each incoming request runs as its own asyncio task, which copies
whatever context existed at task-creation time — so these vars start
back at their defaults for every new request with no manual reset
needed between requests. Mutating them (RequestContextMiddleware,
TenantMiddleware, AuthMiddleware) before calling further into the
stack is safe: nested/child tasks spawned after a `.set()` inherit
that value. Reading them back in a middleware *after* an inner layer's
`call_next()` has already returned is not guaranteed to see that
inner layer's mutations, if the ASGI framework runs deeper layers as
separate tasks — see RequestContextMiddleware for how its access-log
line avoids depending on that direction.
"""
import contextvars

_request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)
_tenant_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "tenant_id", default=None
)
_user_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "user_id", default=None
)


def set_request_id(value: str | None) -> None:
    _request_id_var.set(value)


def set_tenant_id(value: str | None) -> None:
    _tenant_id_var.set(value)


def set_user_id(value: str | None) -> None:
    _user_id_var.set(value)


def get_context() -> dict[str, str | None]:
    """Current request-scoped log-enrichment fields.

    Fields default to None outside a request (app startup, a
    background task with no request in flight) — JSONFormatter omits
    None fields rather than logging them as null.
    """
    return {
        "request_id": _request_id_var.get(),
        "tenant_id": _tenant_id_var.get(),
        "user_id": _user_id_var.get(),
    }
