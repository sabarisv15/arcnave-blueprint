# RequestContextMiddleware (request_context.py) is outermost: mints/
# honors request_id and logs one access-log line per request.
# AuthMiddleware (auth.py) decodes a bearer JWT if present; per-route
# "this requires auth" enforcement is RBAC (app/api/deps.py's
# require_role). TenantMiddleware (tenant.py) resolves the tenant
# (subdomain, JWT claim, explicit code) and owns beginning the
# per-request transaction, since the transaction can't be scoped to a
# tenant until the tenant is known. All three update the request-
# scoped contextvars in app/core/request_context.py as they resolve
# request_id/tenant_id/user_id, so every log line emitted anywhere
# during a request is automatically enriched.
