# Module 0 — Platform Foundation

> **Superseded** — this document describes the original Python/FastAPI
> implementation (ADR-016 replaced it with Express/Node.js).
> Recoverable via `git log`/`git show`. Not rewritten yet; do not treat
> anything below as describing the current backend.

## Node rebuild — current status

This is the up-to-date record of the Express/Node.js rebuild (ADR-016).
Everything else in this document, from "Status: Complete" onward,
describes the deleted Python implementation and is kept only as
historical/design reference (resolution priority order, RLS reasoning,
etc. — the *design* didn't change, only the code implementing it).

Built and tested so far, in the same incremental order the Python
version was originally built:

- **Schema + RLS**, ported faithfully from the deleted Alembic
  migrations into two `node-pg-migrate` migrations
  (`backend/migrations/1751500000000_module-0-platform-foundation.js`,
  `..._1751600000000_principal-invitations.js`) — same tables, same
  `FORCE ROW LEVEL SECURITY`, same directional grants, not redesigned.
- **RLS pooled-connection leak test**
  (`backend/tests/rls-tenant-isolation.test.js`) — re-proven from
  scratch against `node-postgres`'s own pooling, not assumed to still
  hold just because the SQL didn't change. Connection reuse verified
  via `pg_backend_pid()`, same technique as the original Python test,
  since it's a Postgres builtin rather than anything driver-specific.
- **Tenant Middleware** (`backend/src/middleware/tenant.js`) —
  resolves `college_id` from (1) subdomain (`Host` header), (2) JWT
  claim, (3) explicit `X-College-Code` header, same priority order and
  same fail-on-disagreement (never silent-pick-one) behavior as the
  Python version. Source (2)'s `// TODO(auth)` is now resolved — see
  JWT auth below; `req.jwtClaims` is real and populated by the time
  this middleware reads it. Opens a per-request transaction on
  `arcnave_app` and calls `set_config('app.current_tenant', ..., true)`
  when a tenant resolves.
  - **The one piece that was not a direct port, and needed real
    care:** Starlette's `await call_next(request)` gives a single
    awaitable point to commit-after/rollback-around; Express's
    `next()` has no equivalent — it does not return a promise that
    resolves once downstream handling (including the route handler)
    has finished. The correct Express pattern is two separate hooks:
    intercepting `res.end` for the commit path (see below) and the
    4-argument error-handling middleware
    (`backend/src/middleware/errorHandler.js`, reached only via
    `next(err)`) for the rollback path. A `settled` flag in `tenant.js`
    ensures only whichever runs first actually touches the
    transaction. Proven, not assumed: `tests/tenant-middleware.test.js`'s
    rollback test drives a route that does a real partial write to
    `configurations` and then throws, then asserts via the
    migration-owner connection that nothing was persisted.
  - **The commit path was originally `res.on('finish', ...)`, and that
    was a real, live bug — found empirically during the
    ConfigurationService slice, not by inspection.** `'finish'` fires
    only *after* Node has already flushed the response to the client's
    socket, meaning a fast client could receive a "success" response
    and immediately issue a follow-up request that raced the `COMMIT`
    itself. Surfaced as intermittent `auth.test.js` failures
    ("Invalid refresh token" on a token issued moments earlier) that
    reproduced consistently under a tight, rapid login-then-refresh
    diagnostic — the exact class of bug this project's tests exist to
    catch, just discovered a slice later than the code that caused it.
    Fixed by intercepting `res.end` itself (the low-level method every
    response helper funnels through) so the commit always completes
    *before* any byte reaches the client, not after. Confirmed with 3
    consecutive clean full-suite runs plus a 30-iteration rapid
    login-then-refresh stress diagnostic, where the bug had previously
    reproduced within 1–2 iterations every time.
  - `backend/src/app.js` exports a `createApp()` factory rather than a
    singleton, specifically so a test can insert its own route
    *before* `errorHandler` is attached — Express only routes an error
    to error-handling middleware registered later in the stack than
    where it occurred, never earlier, so a route added after the app
    module already finished executing would never reach the real error
    handler otherwise.
- `GET /api/v1/whoami` — same proof-of-pipeline shape as the Python
  version: reads `current_setting('app.current_tenant', true)` back
  from the database itself, not any in-memory value, so a passing
  response proves the whole chain actually reached Postgres.
- **Tests** — `backend/tests/tenant-middleware.test.js`, 8 cases
  against a live Postgres container (started via a real
  `app.listen(0)`, driven with Node's built-in `http` module rather
  than `fetch()` specifically so the `Host` header can be set with
  certainty): subdomain resolves; explicit code resolves; the two
  agreeing doesn't false-positive as a conflict; the two disagreeing
  400s; no tenant resolving 400s; `/health` still needs no tenant; six
  sequential requests alternating between two tenants on the same
  pooled connection never leak into each other (the middleware-level
  analogue of the RLS leak test); and the rollback-on-error case
  described above. All passing.
- **JWT auth** (`backend/src/security.js`,
  `backend/src/repositories/authRepository.js`,
  `backend/src/services/authService.js`,
  `backend/src/routes/auth.js`) — tenant-side login, refresh rotation,
  logout, and a password-reset stub, same scope as the deleted Python
  `auth_service.py`/`security.py`/`api/v1/auth.py`. Registered after
  `tenantMiddleware` in `app.js` — ordinary tenant-scoped routes using
  `req.dbClient`/`req.collegeId`, not to be confused with
  `AuthMiddleware` below.
  - Password hashing via the `argon2` npm package (`node-argon2`), not
    a placeholder. Its API was checked against the real package source
    before relying on it, not assumed to mirror Python argon2-cffi's:
    it genuinely does expose `needsRehash(digest, options)`, so
    opportunistic rehash-on-login was kept, not dropped.
  - `createAccessToken`/`decodeAccessToken` via `jsonwebtoken` — same
    `sub`/`college_id`/`role`/`type: "access"` claim shape,
    `JWT_SECRET_KEY` required with no fallback (same reasoning as
    `DATABASE_URL`). One `TokenError` class wraps `jsonwebtoken`'s
    whole exception surface, same as the deleted Python `TokenError`.
  - `generateRefreshToken`/`hashRefreshToken` via `node:crypto`
    (`randomBytes` + SHA-256) — SHA-256, not argon2, deliberately: a
    server-generated high-entropy token isn't a brute-force target the
    way a password is.
  - `login` — one generic `AuthError` covering unknown username, wrong
    password, and inactive account alike (enumeration protection).
    `refresh` — rotation; reuse of an already-revoked token logs
    `refresh_token_reuse_detected` via plain `console.warn` (the
    structured/request-ID-enriched logging layer is its own later
    slice, not built this pass) rather than being a routine rejection.
    `revoke` (logout) — idempotent. `requestPasswordReset` — a genuine
    stub that throws, turned into `501` at the route layer; no fake
    `NotificationService`.
- **AuthMiddleware** (`backend/src/middleware/auth.js`) — decodes a
  bearer token if present and sets `req.jwtClaims`; non-enforcing,
  never rejects a missing/invalid token itself (RBAC does that, below).
  Registered *before* `tenantMiddleware` in `app.js`. Worth noting as a
  genuine simplification over the Python port, not a direct
  translation: Express runs `app.use()` in literal registration order
  (unlike Starlette, where middleware added last runs first), so "Auth
  before Tenant" is just declaring them in that order — no inversion
  required.
- **Tests** — `backend/tests/auth.test.js`, 12 cases against a live
  Postgres container: login success (and the issued JWT's claims
  checked, not just its presence), wrong password, unknown username,
  inactive user; refresh rotation (old token stops working), reuse of
  a revoked token rejected *and* actually verified as logged (`console.warn`
  captured for the duration of that one call, not trusted from reading
  the code); logout revokes a token and idempotently no-ops for an
  unknown one; password-reset `501`s; plus the three JWT-claim
  tenant-resolution cases that couldn't exist until now — resolves
  from a JWT claim alone, agrees with a matching subdomain (not a
  false-positive conflict), and a JWT claiming one tenant plus a
  subdomain resolving to a different one `400`s, never silently
  picking either.
- **RBAC** (`backend/src/middleware/rbac.js`) — `requireRole(...allowedRoles)`
  and a bare `requireAuth`, tenant-side only. Neither hardcodes a role
  list: `requireRole` takes whatever role strings a route passes it
  (BusinessRules.md still leaves the tenant role model — "College
  Admin," whether "Class Tutor" becomes a role — an open question,
  resolved during Module 2, not guessed at here). No `requirePlatformAdmin`
  in this file, deliberately — BusinessRules.md and ADR-010 treat
  Platform operations as structurally outside the tenant RBAC model
  entirely, not a role within it; that belongs to the Platform API's
  own, not-yet-rebuilt auth.
  - Two distinct failure modes: `req.jwtClaims` null (or wrong `type`,
    same belt-and-suspenders check as the deleted Python version, in
    case `jwtSecretKey`/a future platform secret ever collided) → `401`.
    Claims present but `role` not in the allowed set → `403`.
  - `GET /api/v1/auth/me` is the first real protected route, same as
    the Python original — but gated by `requireAuth`, not
    `requireRole('staff', 'hod', 'principal')`: "return my own
    identity" isn't a role-gated capability, and spelling out every
    known role at this one call site would silently under-cover a
    future new role nobody remembered to add here. A deliberate,
    explained deviation from the Python precedent, not an oversight.
  - No real business route yet needs a role *subset* restriction
    (ConfigurationService's write route was the first one to need this
    in Python — not rebuilt in Node yet). Proving `requireRole`'s
    403 path honestly needed the same solution the Python version
    used for the identical reason: a test-only `/restricted` route,
    registered via `createApp()`'s `registerExtraRoutes` hook (not a
    permanent route on the real app) and driven through a real HTTP
    request against the real `AuthMiddleware`/`requireRole` wiring —
    not the middleware function called directly.
  - **Tests** — `backend/tests/rbac.test.js`, 10 cases: `/me` returns
    `401` with no token, a malformed token, and an expired token
    (constructed with an explicit past `exp`, not relying on
    `jsonwebtoken`'s `expiresIn` accepting a negative duration); `200`
    for each of staff/hod/principal, response body checked against the
    token's actual claims. `requireRole`'s subset restriction: `401`
    with no token, `403` for `staff` (outside the `hod`/`principal`
    allowed set), `200` for `hod`/`principal`.
- **Request-scoped structured logging**
  (`backend/src/logging/context.js`, `backend/src/logging/logger.js`,
  `backend/src/middleware/requestContext.js`) — replaces every ad hoc
  `console.warn`/`console.error` call added in the previous two slices;
  none were left sitting next to the new logger.
  - `runWithRequestContext`/`getRequestContext` wrap `node:async_hooks`'s
    `AsyncLocalStorage`, store shape `{ requestId, collegeId }`
    (deliberately narrower than the deleted Python version's three-field
    `{request_id, tenant_id, user_id}` — no `user_id` yet; flagged
    below, not silently dropped).
  - **The Python gotcha this replaces was Starlette-specific, not
    assumed to carry over — and it didn't.** The deleted Python
    version's forced workaround existed because
    `BaseHTTPMiddleware` runs downstream handling inside a copied
    asyncio Task, so an inner layer's contextvar mutation wasn't
    guaranteed to propagate back to an outer layer's task after
    `await call_next()` returned. Express has no equivalent
    architecture — `next()` continues the chain in-line, no task-copying
    wrapper — so there was reason to expect
    `als.run(store, () => next())` might just work cleanly. That
    expectation was proven, not assumed: see the concurrent-requests
    test below, the direct equivalent of
    `test_rls_tenant_isolation.py`'s `pg_backend_pid()` proof applied
    to log context instead of tenant context. It passed on the first
    real run with no propagation issue found.
  - `requestContextMiddleware` is registered *first* in `app.js` —
    before even `express.json()` and `/api/v1/health` — so its access
    log covers every request and every other middleware/route runs
    inside the `AsyncLocalStorage` context it opens.
  - `tenant.js`'s `resolveTenant` mutates `getRequestContext().collegeId`
    in place once a tenant resolves, rather than opening a second
    nested context — this is what lets a log line from deep inside
    `authService.refresh()` (which only ever receives `client`, never
    `req`) pick up `collegeId` automatically, the same way it already
    picks up `requestId`.
  - **The access-log line itself reads `req.requestId`/`req.collegeId`
    directly, not `getRequestContext()`** — stated plainly per the
    build brief, not silently picked: the `res.on('finish', ...)`
    callback already closes over `req`, a reliable plain-object
    reference mutated in place by `tenantMiddleware` before `'finish'`
    ever fires, so there's no reason to route through
    `AsyncLocalStorage` for data already available more directly. This
    is *not* a workaround for a known propagation gap the way the
    Python version's equivalent read (`request.state`, not the
    contextvar) was forced to be — the `AsyncLocalStorage` path itself
    is proven separately by the concurrent test, which specifically
    exercises `authService.refresh`'s call site, the one place that
    genuinely has no `req` in scope.
  - **One `res.on('finish', ...)` hook covers both the success and
    error paths — not two.** Unlike `tenant.js`'s commit/rollback pair
    (which needs exactly one of two *different* DB operations to run,
    hence its `settled` guard), the access log is the same operation
    regardless of outcome, and `'finish'` fires unconditionally once a
    response has actually been sent — whether that response came from
    a route handler completing normally or from `errorHandler.js`
    eventually calling `res.status(500).json(...)`. Confirmed directly
    in a live run: `tenant-middleware.test.js`'s existing
    rollback-on-error case now also emits a `request_completed` line
    with `status: 500`, from the same single hook.
  - `authService.js`'s `refresh_token_reuse_detected` now goes through
    `logWarn`; `tenant.js`'s commit-failure log and `errorHandler.js`'s
    rollback-failure/unhandled-error logs now go through `logError`.
  - **Tests** — `backend/tests/request-logging.test.js`, 7 cases: the
    access log carries `requestId` and omits `collegeId` entirely (not
    as `null`) when unresolved; carries `collegeId` when resolved;
    `X-Request-ID` generated and echoed; an incoming `X-Request-ID`
    header honored; five sequential requests get five distinct
    `requestId`s; `authService.refresh`'s reuse-detection log — the one
    real call site with no `req` in scope at all — picks up
    `requestId`/`collegeId` automatically through a real
    login → refresh → refresh(reuse) flow; and **the test that actually
    matters**: two requests fired via `Promise.all` (not sequential —
    sequential requests could pass even under a broken shared-global
    implementation if Node happened to serialize them) against a
    deliberately-delayed test-only route with a deeply-nested log call,
    asserting each request's own `requestId` shows up on its own log
    line, never the other's. All passing — 44/44 Node tests total.

Known limitation carried forward from this slice: the ambient context
doesn't track `userId`, unlike the deleted Python version — deliberate
per the build brief's store shape, not an oversight. Revisit once a
real consumer needs it (e.g. an audit-log-style feature wanting
`userId` on every line automatically, not just the routes that already
have `req.jwtClaims` in scope).
- **Super Admin Portal API** (`backend/src/tenantApp.js`,
  `backend/src/platformApp.js`, `backend/src/app.js`, plus
  `security.js`/`config.js`/`db/pool.js` additions) — platform-admin
  login and college creation only, this pass, matching the deleted
  Python version's own original scope before principal invitation was
  added later (that slice still isn't built here either).
  - **This is the one where the Python build hit a real, documented
    bug worth re-reading before touching this slice.** Its first
    attempt mounted platform routes as a sub-app under a single
    top-level app that carried `TenantMiddleware`/`AuthMiddleware`
    directly; an isolation test caught `request.state.college_id`/
    `jwt_claims` leaking onto platform-mounted requests, because
    Starlette's middleware wraps the entire ASGI callable before any
    routing/mounting decision happens. The fix was two genuinely
    separate peer sub-apps under a middleware-free top-level app.
  - **Express's `app.use(prefix, subApp)` was not assumed to be
    automatically as isolated as Starlette's `Mount` was wrongly
    assumed to be** — that exact assumption is what failed last time,
    and assuming the Express equivalent "just works" would have been
    the same mistake in a different dialect. The port mirrors the
    Python fix's shape for a documented, Express-specific reason:
    `backend/src/tenantApp.js` and `backend/src/platformApp.js` are
    each their own `express()` instance with their own complete
    middleware stack (each app's stack is independent; mounting a
    sub-app via `app.use(prefix, subApp)` does not retroactively make
    it inherit an ancestor's middleware *unless* the ancestor has
    middleware of its own registered ahead of the mount point — which
    is exactly why `app.js` has none). Chose path-prefix mounting on
    a middleware-free outer app over two separate `listen()` calls
    (the other option that would achieve equivalent isolation):
    it keeps the single-port, single-process external surface the
    Python version had and docker-compose.yml/the frontend already
    assume, rather than introducing a second port this slice doesn't
    actually need. Mount order matters, same reasoning as the Python
    version: `/api/v1/platform` is registered before `/api/v1`, since
    path-prefix matching stops at the first match.
  - **This was verified empirically against the real mounted
    structure, not inferred from the code looking separated** —
    `backend/tests/platform.test.js`'s isolation test is the direct
    Node equivalent of the Python test that caught the original bug,
    using the same technique (a probe route injected into the actual
    `platformApp` instance `app.js` mounts, via the new
    `registerPlatformExtraRoutes` hook, checking `'jwtClaims' in req`/
    `'collegeId' in req`/`'dbClient' in req` — those are set *only* by
    `authMiddleware`/`tenantMiddleware`, nowhere else in this
    codebase). It passed on the real structure with no leak found.
  - One real bug surfaced and was fixed during this slice, not before
    it: `requestContextMiddleware`'s access log used `req.path`, which
    is mount-relative inside a sub-app (Express strips the mount
    prefix, same as Starlette's `Mount`) — so it silently started
    logging `/health` instead of `/api/v1/health` once tenantApp
    became a mounted sub-app instead of the top-level app. Caught by
    the existing `request-logging.test.js` suite failing, not
    predicted in advance. Fixed by switching to `req.originalUrl`
    (stripped of any query string), which is unaffected by mounting.
  - **A second, structurally separate JWT** — `PLATFORM_JWT_SECRET_KEY`
    (own env var, required, no fallback to `JWT_SECRET_KEY`),
    `createPlatformAccessToken`/`decodePlatformAccessToken` in
    `security.js`, claim shape `{sub, type: 'platform_access'}` —
    deliberately no `college_id`/`role` fields at all, so no code path
    could confuse a platform token for a tenant one even by accident.
  - **Platform DB access exclusively through `platformPool`**
    (`db/pool.js`, wired since the JWT-auth slice but unused until
    now) — `arcnave_platform`, which per the ported migrations has
    zero grants on any tenant table. `platformRepository.js`/
    `platformService.js` touch only `platform_admins`/`colleges`.
  - **No per-request transaction middleware for platform routes,
    unlike tenant routes — a deliberate simplification, not a gap.**
    Every operation this pass is a single statement (one `SELECT` for
    login, one `INSERT` for college creation); Postgres autocommits a
    standalone statement, so there's no cross-statement atomicity
    requirement to protect the way tenant routes genuinely have one
    (`set_config(...)` and the query it scopes *must* share one
    transaction, or RLS fails closed on the next statement). Routes
    call `platformService` functions with `platformPool` directly, not
    a checked-out client.
  - `login` — enumeration-safe, same `PlatformAuthError`-for-every-
    failure-mode pattern as tenant login. **No refresh-token rotation**
    — checked against the deleted Python version rather than assumed
    Module 0's scope called for parity with tenant auth: it didn't
    build this either (see Known Limitations). Platform admins simply
    re-authenticate when their access token expires.
  - `createCollege` — the platform admin's actual job, an `INSERT`
    into `colleges`. `409` on a duplicate `college_id`/`subdomain` via
    Postgres's `23505` (`unique_violation`) SQLSTATE, not a raw
    constraint-violation `500`.
  - `requirePlatformAdmin` (`middleware/platformAuth.js`) — decodes
    the bearer token itself, unlike `requireRole`/`requireAuth`: the
    platform app never runs `authMiddleware`, so there's no upstream
    middleware that already did this. Structurally separate from
    `middleware/rbac.js`, not a shared/unified dependency — same
    reasoning as the deleted Python version's `require_platform_admin`
    docstring: a single "check role, maybe check type" middleware
    shared between both token kinds would be one `if`-branch away from
    accidentally accepting the wrong type.
  - **Tests** — `backend/tests/platform.test.js`, 10 cases: platform
    login success (no `refresh_token` key at all in the response) /
    wrong password / unknown username; college creation success /
    duplicate `college_id` / duplicate `subdomain` / no-token `401`;
    cross-boundary — a platform token against a tenant `requireAuth`-
    gated route `401`s, a tenant token against `requirePlatformAdmin`
    `401`s, both failing at signature verification (different
    secrets), not a role/type check that could be a weaker guarantee;
    and the isolation proof described above.

- **ConfigurationService** (`backend/src/repositories/configurationRepository.js`,
  `backend/src/repositories/auditLogRepository.js`,
  `backend/src/services/configurationService.js`,
  `backend/src/routes/configurations.js`) — the generic JSONB config
  store mechanism, same scope as the deleted Python
  `configuration_service.py`/`configuration_repository.py`/
  `api/v1/configurations.py`. `category`/`configuration` stay opaque —
  no category enum, no shape validation, same restraint as everywhere
  else in this module.
  - **Checked the Python version's actual behavior before writing
    anything, per the build brief — three things confirmed, not
    reinvented:** an unset category is a clean `404`, never a default
    empty object; the `version` column implements genuine optimistic
    concurrency (the caller must pass the version they last read, `409`
    on any mismatch), never a blind increment-on-every-write; writes
    are gated to `require_role("principal")` specifically — a
    hardcoded single role the Python version's own comment already
    flagged as a conservative default, not a settled decision, ported
    as-is rather than silently resolved or silently loosened.
  - **`configurationRepository.upsertConfiguration` is a single
    `INSERT ... ON CONFLICT (college_id, category) DO UPDATE ... WHERE
    configurations.version = $expectedVersion` statement — not a
    structural port of the Python version's two-function
    create/update split, but a faithful port of the *observable*
    concurrency behavior it implemented.** Postgres's own
    conditional-`DO UPDATE` natively covers every case the Python
    version needed exception-handling for: no existing row → the
    `INSERT` branch fires unconditionally (the service layer validates
    `expectedVersion` shape *before* calling this, same as Python's
    pre-check); existing row, version matches → the `WHERE` passes,
    `UPDATE` proceeds; existing row, version doesn't match (a stale
    write, *or* two callers racing to create the same category — the
    loser always sees a real row by the time it runs) → the `WHERE`
    fails, nothing is modified, `RETURNING` yields zero rows. That
    last case was proven with a real stale-version test, not assumed
    from reading Postgres's conditional-upsert documentation.
  - `GET /api/v1/configurations/:category` — `requireAuth` (any
    authenticated tenant user), matching the Python version's
    `require_role(*TENANT_ROLES)`. `PUT /api/v1/configurations/:category`
    — `requireRole('principal')`, matching the Python version exactly.
    Both check `req.collegeId !== null` before calling the service,
    same defensive reasoning as the login route: `requireAuth`/
    `requireRole` verify the JWT is valid, not that `TenantMiddleware`
    actually resolved a tenant for it — those are genuinely separate
    failure modes (a validly-signed token can claim a `college_id`
    that doesn't resolve to any real college).
  - Every successful write still creates one `audit_log` row
    (`action: 'configuration_updated'`, ported alongside the rest —
    the Python version's `set_configuration` treated it as part of the
    same operation, not an optional extra, so leaving it out here
    would have been a silent behavior gap relative to "what the Python
    version actually did." New, small, cross-cutting
    `auditLogRepository.js` — the same one-function-only restraint the
    Python version's `audit_log_repository.py` had.
  - **Tests** — `backend/tests/configurations.test.js`, 11 cases: get
    on an unset category `404`s; set creates at version 1; set on an
    existing category updates and increments version across three
    successive writes; a stale `expected_version` is rejected with
    `409`, tested against a version that was made genuinely stale by a
    real intervening write (not just an arbitrary wrong number), and
    the rejected write is confirmed to have changed nothing; a
    non-null `expected_version` against a category that doesn't exist
    yet is also rejected; write `403`s for `staff`, `401`s
    unauthenticated; read succeeds for `staff` (not just `principal`),
    `401`s unauthenticated; **the tenant-scoping proof** — two tenants
    set the *same* category name independently, both land at version 1
    (a collision would mean the route used some connection other than
    `req.dbClient`, bypassing RLS's tenant scoping), and each only
    reads back its own value; and the audit log row + metadata check.
  - **A real, pre-existing bug in `tenant.js` surfaced while writing
    this slice's tests, unrelated to ConfigurationService itself — see
    the Tenant Middleware entry above for the fix.** Worth noting here
    specifically because it's exactly the kind of bug a
    write-then-immediately-verify test (which most of
    `configurations.test.js` is) would have been vulnerable to if it
    hadn't already been fixed by the time these tests were written.

- **Principal invitation** (`backend/src/repositories/principalInvitationRepository.js`,
  `backend/src/db/tenantTransaction.js`,
  `backend/src/routes/invitations.js`, plus additions to
  `platformService.js`/`routes/platform.js`/`authRepository.js`) —
  Option B (invite-record-now, create-user-later), same scope as the
  deleted Python `principal_invitation_service.py`/
  `principal_invitation_repository.py`. Unusually well-documented
  already — the Features entry above (this document, further up) had
  the full historical Python design written out in detail; ported
  faithfully from that rather than re-derived. Migration
  (`1751600000000_principal-invitations.js`) was already done in the
  Super Admin Portal API slice — this was purely the application
  layer.
  - `POST /api/v1/platform/colleges/:college_id/invite-principal`
    (`requirePlatformAdmin`, on `platformApp`) — creates the
    invitation, returns the raw token directly in the response body
    (temporary stand-in for real email delivery, same pattern as the
    `501` password-reset stub — NotificationService still doesn't
    exist), `404` if `college_id` doesn't exist (a `23503`
    foreign_key_violation on the INSERT, the one and only FK this
    table has).
  - `POST /api/v1/invitations/accept` (on `tenantApp`, deliberately
    unauthenticated — no `requireAuth`/`requireRole`) — `{token,
    username, password}` → creates the `users` row with
    `role: 'principal'`, `is_active: true` immediately (the invitation
    itself is the activation; there's no one else at that college yet
    to approve them). Token generation/hashing reuses `security.js`'s
    existing `generateRefreshToken`/`hashRefreshToken` verbatim, same
    threat-model reasoning as refresh tokens, not a new scheme. A
    generic, enumeration-safe `401` ("Invalid or expired invitation")
    covers expired, already-accepted, and unknown tokens alike; reuse
    of an already-accepted token additionally logs
    `principal_invitation_reuse_detected` via `logWarn` — a merely-
    expired-never-accepted token does not log, same asymmetry
    `authService.refresh` already has between stale and reused
    refresh tokens. `409` if the requested username is already taken
    within that tenant.
  - **The one genuinely new architectural problem this slice had,
    since the Python version never split into separate tenantApp/
    platformApp instances:** `/invitations/accept` is the single
    deliberate bypass of normal tenant resolution in the whole
    codebase — the caller has no subdomain/JWT/explicit-code (no
    account exists yet), so the invitation's own `college_id` is the
    tenant signal, not anything `tenantMiddleware` would resolve. It's
    registered *before* `authMiddleware`/`tenantMiddleware` in
    `tenantApp.js`, same as `/health`, and opens its own transaction
    scoped to the invitation's `college_id` once the token's been
    looked up on a short-lived resolution connection (mirroring
    `tenantMiddleware`'s own colleges lookup — `principal_invitations`
    has no RLS, so this needs no tenant context at all).
  - **Did not hand-roll a second copy of the transaction/commit/
    rollback machinery for this one route.** `tenant.js` had just gone
    through a real, subtle bug in exactly that logic (the `res.end`-
    interception fix, see Tenant Middleware above) — duplicating it
    here would have risked reintroducing an equivalent bug
    independently, in a route with a much smaller test surface.
    Instead, that logic was extracted out of `tenant.js` into
    `db/tenantTransaction.js`'s `openTenantTransaction(req, res,
    collegeId)`, taking an already-known `collegeId` as a parameter.
    `tenantMiddleware` now just calls it with whatever `resolveTenant`
    resolved (unchanged behavior, confirmed by the full existing test
    suite still passing unmodified); `/invitations/accept` calls it
    with the invitation's `college_id` once known. Both callers get
    the identical guarantees, including `getRequestContext().collegeId`
    being mutated in place the same way `tenant.js` already did — so
    this route's own log lines and the final access-log entry reflect
    the right tenant even though it never went through normal
    resolution.
  - `authRepository.createUser` — a plain, generic INSERT, not
    principal-invitation-specific, reusable by any future flow that
    needs to create a tenant user.
  - **Tests** — `backend/tests/principal-invitation.test.js`, 8 cases:
    invitation creation requires a platform-admin token, succeeds,
    `404`s for an unknown college; accept creates a user verified as
    tenant-scoped through RLS itself (a second engine, `set_config`'d
    to each college in turn — the same technique as
    `test_rls_tenant_isolation.py`), and the created account is
    proven to actually log in through the ordinary tenant path; an
    expired token and a reused already-accepted token both `401` with
    the identical message, and the reuse case is confirmed logged by
    capturing `console.warn` output the same way `auth.test.js`
    already does, not trusted from the code path being present; an
    unknown token `401`s with the same message too; a duplicate
    username within one tenant `409`s; and the cross-tenant proof —
    two colleges, two invitations, the *same* requested username,
    confirming neither invitation's acceptance can ever create or be
    seen under the other's `college_id`.
  - `docs/architecture/ERD.md` — one stale reference fixed (it still
    pointed at the deleted Python migration path for
    `principal_invitations`; now points at the Node one). The schema
    itself did not change.

All 77 Node tests pass across the eight test files.

Not built yet in Node: nothing left in Module 0's original build list
— the only remaining item is the Node-specific CI workflow, which
covers *how* these tests run in CI, not application code.

---

Status: **Complete.** Every item on this module's build list is done
and tested (see Features below). This document now freezes except bug
fixes, per `Roadmap.md` — Module 1 (Student) starts fresh, on top of
this. Remaining gaps are deliberate, deferred scope, not unfinished
Module 0 work — see Known Limitations.

## Purpose

Everything required before a single student exists: tenant
provisioning, the database foundation with enforced tenant isolation,
identity/auth, and the developer platform (Docker, migrations, API
versioning) that every later module builds on. See `Roadmap.md` §
"Module 0 scope" for the authoritative scope list.

## Dependencies

None — this is the first module. Every other module depends on it.

## Features

Planned for Module 0, in build order:

- [x] Docker Compose environment (PostgreSQL + app)
- [x] FastAPI project scaffold (`/api/v1` versioning, health check)
- [x] Alembic migrations, configured for RLS-aware DDL
- [x] Module 0 schema (platform + tenant tables) as first migration
- [x] RLS policies on every tenant table, `FORCE ROW LEVEL SECURITY`,
      least-privilege `arcnave_app` DB role separate from the
      migration-owner role (ADR-015) — `audit_log` deliberately
      narrower than the rest: `SELECT, INSERT` only, no `UPDATE`/
      `DELETE`, so the app role can never rewrite or erase the trail
- [x] Two-tenant-on-one-pooled-connection RLS leak test (release gate
      per ADR-002) — `backend/tests/integration/test_rls_tenant_isolation.py`,
      passing against a live Postgres container
- [x] Tenant Middleware (`app/middleware/tenant.py`) — resolves
      college_id from (1) subdomain, (2) JWT claim, and (3) explicit
      college code (`X-College-Code` header) per Architecture.md 2.2's
      priority order, rejects conflicting sources instead of silently
      picking one, and opens the per-request transaction + calls
      `set_tenant_context()` before any route handler runs.
- [x] `/api/v1/whoami` — minimal route proving the pipeline end to
      end: returns `current_setting('app.current_tenant', true)` read
      back from the DB itself, not the middleware's in-memory value.
- [x] Tenant Middleware integration test —
      `backend/tests/integration/test_tenant_middleware.py`, hits
      `/api/v1/whoami` via FastAPI's `TestClient` for subdomain
      resolution, explicit-code resolution, JWT-claim resolution,
      every pairwise matching-sources agreement, every pairwise
      conflicting-sources rejection (400) — including the JWT-vs-
      subdomain case added once JWT auth existed — an invalid JWT
      being ignored rather than rejecting the request outright,
      no-tenant rejection (400), `/health` working with no tenant at
      all, and a sequential-alternating-tenants run proving no
      cross-request leakage. All passing against a live Postgres
      container.
- [x] JWT auth (`app/services/auth_service.py`,
      `app/api/v1/auth.py`) — tenant-side login only (`users` table);
      Platform Admin login is a separate, not-yet-built concern, see
      Known Limitations.
  - Login verifies against `users` with argon2 (`argon2-cffi`), never
    a placeholder hash; a single generic "Invalid username or
    password" covers unknown username, wrong password, and inactive
    account alike, so the response can't be used to enumerate
    usernames or pending-activation state.
  - Access tokens are short-lived JWTs (HS256, 15 min default).
    Refresh tokens are opaque random strings (`secrets.token_urlsafe`);
    only their SHA-256 `token_hash` is ever stored, never the raw
    token — `refresh_tokens.token_hash` as the ERD already specified.
  - Refresh rotates: using a refresh token revokes it and issues a
    new one. Presenting an already-revoked token is treated as a
    possible-theft signal — logged via structured JSON
    (`refresh_token_reuse_detected`, with college_id/user_id/
    refresh_token_id) — not just quietly rejected. (Revoking the rest
    of that user's active refresh tokens on detection is a deliberate
    scope cut — see Future Enhancements.)
  - `POST /api/v1/auth/logout` revokes a refresh token; idempotent for
    an unknown/already-revoked one.
  - `POST /api/v1/auth/password-reset` is a stub returning 501 —
    Roadmap.md lists it in Module 0 scope, but a real implementation
    needs NotificationService (not built) and a reset-token flow;
    building that now would be scope creep past what this module
    needs.
  - JSON log formatter (`app/core/logging.py`) now surfaces `extra={}`
    fields per call — needed to make the reuse-detection log line
    actually inspectable. (Automatic request_id/tenant_id/user_id
    enrichment on every line arrived later in this module — see
    request-scoped structured logging below.)
- [x] RBAC — `require_role(*roles)` (`app/api/deps.py`), a FastAPI
      dependency reading `request.state.jwt_claims` (set by
      `AuthMiddleware`, already signature/expiry-verified): no claims
      → 401 (not authenticated); claims present but `role` not in the
      allowed set → 403 (authenticated, not authorized). No DB lookup
      — role is a claim already embedded in the access token at login.
      Enforces only the three known tenant roles (`staff`/`hod`/
      `principal`, exposed as `TENANT_ROLES`); `platform_admin` RBAC
      belongs to the not-yet-built Platform API (ADR-010), not this
      module. Does **not** resolve BusinessRules.md's open "College
      Admin vs. Class Tutor" role-model question — that's Module 2's
      call; this dependency only enforces membership in whatever role
      set a route declares.
- [x] `GET /api/v1/auth/me` — first real RBAC-gated route, behind
      `require_role(*TENANT_ROLES)` (any authenticated tenant user).
      Returns `user_id`/`college_id`/`role` straight from the JWT's
      already-verified claims — no DB lookup needed, same reasoning
      as `require_role` itself.
- [x] Request-scoped structured logging (`app/core/request_context.py`,
      `app/middleware/request_context.py`) — Architecture.md's
      observability section (request_id, tenant_id, user_id, method,
      status, duration_ms) implemented via `contextvars`, deliberately
      not thread-locals (those don't propagate correctly across await
      boundaries under FastAPI's async model — a thread-local is
      shared by every coroutine on the same OS thread, which breaks
      the moment two requests interleave on one event loop).
  - `RequestContextMiddleware` is outermost (added last in `main.py`):
    mints/honors an incoming `X-Request-ID` header, sets it as the
    request_id contextvar before descending further, and echoes it
    back as a response header. `TenantMiddleware`/`AuthMiddleware`
    each gained a one-line addition to update the same context with
    tenant_id/user_id as soon as they resolve them — no new middleware
    phase, per the ordering comment already in `main.py` about not
    splitting `TenantMiddleware` to get a literal fourth phase.
  - `JSONFormatter` now merges the current contextvar state into every
    record automatically, same mechanism as the existing `extra={}`
    merge (explicit `extra` wins on key collision). This means
    `AuthService`'s existing `refresh_token_reuse_detected` log call
    gained `request_id` enrichment with **zero changes to
    `auth_service.py`** — that's the actual point of contextvars over
    threading a `request_id` parameter through every function
    signature.
  - One `request_completed` access-log line per request (method, path,
    status, duration_ms, plus tenant_id/user_id when resolved),
    emitted in a `finally` block so it still fires on an unhandled
    exception (status defaults to 500 in that case). Deliberately
    reads tenant_id/user_id from `request.state` for *this specific
    line*, not the contextvar — see `request_context.py`'s docstring
    for why the backward direction (an inner middleware's mutation
    becoming visible to an outer one after `call_next()` returns)
    isn't safe to depend on, unlike the forward direction the general
    enrichment mechanism relies on.
- [x] Super Admin Portal API — **platform auth + college creation
      only, this pass.** Principal invitation, college-code generation
      policy, and licensing/subscription management are not built —
      see Known Limitations, principal invitation especially (it's
      genuinely harder than it looks, two real options written up
      there, not built pending a decision).
  - **Two genuinely separate ASGI sub-applications, not a
    shared-middleware special case.** `app/tenant_app.py` (mounted at
    `/api/v1`) owns `TenantMiddleware`/`AuthMiddleware`/
    `RequestContextMiddleware`; `app/platform_app.py` (mounted at
    `/api/v1/platform`) owns only `RequestContextMiddleware`.
    `app/main.py` itself carries no business middleware at all — it
    exists solely to mount the two peer sub-apps.
  - **This structure exists because the first, simpler attempt was
    empirically wrong.** The original plan — add
    `TenantMiddleware`/`AuthMiddleware` directly to the one top-level
    `app`, mount `platform_app` alongside as a second route — looked
    like isolation but wasn't: Starlette's middleware wraps the
    *entire* ASGI callable before routing/mounting decisions happen,
    so middleware on an outer app runs for every request regardless of
    which `Mount` ultimately serves it. The isolation test (see Tests)
    caught this directly: `request.state.college_id`/`jwt_claims`
    existed on platform-mounted requests under that structure. Moving
    `TenantMiddleware`/`AuthMiddleware` onto their own sub-app, with
    nothing of substance on the app that mounts both, is what actually
    fixes it — confirmed by the same test afterward.
  - Mount order in `main.py` is load-bearing and easy to get backwards:
    `/api/v1/platform` must be registered before `/api/v1`, since
    Starlette matches `Mount`s by path prefix in registration order
    and stops at the first match. Registering `/api/v1` first would
    swallow every `/api/v1/platform/*` request into `tenant_app` before
    it ever reached the more specific mount.
  - `arcnave_platform` — a fourth DB role alongside `arcnave_admin`/
    `arcnave_app`, same ADR-015 reasoning: non-superuser, owns no
    tables, `SELECT`/`INSERT`/`UPDATE` on `platform_admins` and
    `colleges` only, granted in the (still revision `0001`, amended
    rather than a new migration — nothing built on this schema has
    shipped) Module 0 migration. No grant at all on
    `users`/`refresh_tokens`/`audit_log`/`configurations` — the
    platform path structurally cannot touch tenant data, not just by
    convention.
  - `PLATFORM_DATABASE_URL` / `app/core/platform_database.py`
    (`get_platform_db`) — a wholly separate engine/session from
    `app/core/database.py`'s tenant-scoped `get_db()`, in a separate
    module on purpose so the import path itself signals which one
    you're using.
  - Platform JWTs cannot be confused with tenant JWTs, structurally:
    signed with a different secret (`platform_jwt_secret_key`, required,
    no fallback), carry `type: "platform_access"` (never `"access"`)
    and no `college_id`/`role` claim at all. `require_platform_admin`
    (`app/api/platform/deps.py`) is a deliberately separate dependency
    from `require_role`, not a shared/unified one — see its docstring
    for why unifying them was considered and rejected.
    `require_role` was also hardened to check `claims.get("type") ==
    "access"` explicitly, not just role membership, so a platform
    token is rejected by tenant routes even in a hypothetical future
    where both JWT secrets were accidentally set to the same value.
  - `POST /api/v1/platform/auth/login` — verifies against
    `platform_admins` with the same `hash_password`/`verify_password`
    from `core/security.py` (generic, not tenant-specific). No refresh
    token issued — see Known Limitations.
  - `POST /api/v1/platform/colleges` — creates a `colleges` row
    (`college_id`, `name`, `subdomain`; `subscription_status` defaults
    to `'trial'` per the ERD; `created_by` recorded from the
    authenticated platform admin's token). A duplicate `college_id` or
    `subdomain` is a clean `409`, not a raw constraint-violation `500`
    — `platform_service.create_college` catches `IntegrityError`
    specifically.
- [x] ConfigurationService — **the generic JSONB store mechanism only,
      not any category's shape.** Architecture.md eventually hangs
      attendance rules, fee structure, SMTP/SMS, AI provider config,
      approval policies, branding, and templates off the
      `configurations` table, but those categories belong to whichever
      module owns them (Attendance, Finance, Notifications, AI, ...),
      none of which exist yet. `category` is never validated or
      enumerated — an opaque string; `configuration` is opaque JSONB —
      same restraint as deferring the AI Tool Registry's shape to
      Module 9 rather than guessing it now. No new migration: the
      table, its RLS policy, and `arcnave_app`'s grants on it already
      existed from Module 0's first migration, unused until now.
  - `app/repositories/configuration_repository.py` — query mechanics
    only, `college_id` passed explicitly into every query (defense in
    depth, same as `auth_repository.py`, even though RLS also filters).
  - `app/services/configuration_service.py` — `get_configuration`
    returns `None` for an unset category (not an error — a category
    simply not having been configured yet is normal). `set_configuration`
    is **optimistic concurrency, not last-write-wins**:
    `expected_version` must be `None`/`0` to create a category that
    doesn't exist yet, or must match the current stored version to
    update one that does; any mismatch — including the genuine race
    where two writers both see "doesn't exist" and both try to create
    it (caught via the `UNIQUE (college_id, category)` constraint's
    `IntegrityError`) — raises `ConfigurationVersionConflictError`,
    never silently overwrites. Same defensive reasoning already applied
    to refresh-token rotation: concurrent-edit races are a now problem,
    not a later one.
  - Every successful write also inserts one `audit_log` row
    (`action="configuration_updated"`, `entity="configurations"`,
    `entity_id=<category>`, `metadata={old_version, new_version}`) via
    a new, separate `app/repositories/audit_log_repository.py` — one
    function, not a speculative generic `AuditService`; audit_log is
    genuinely cross-cutting (every future module will want it) but
    building more than the one insert function this pass actually
    needs would be the same kind of guessing-ahead this module has
    deliberately avoided everywhere else.
  - `GET /api/v1/configurations/{category}` — `require_role(*TENANT_ROLES)`,
    any authenticated tenant user may read. `PUT
    /api/v1/configurations/{category}` — `require_role("principal")`
    **only**, a deliberately conservative default, not a settled
    decision: BusinessRules.md doesn't yet say who can change
    configuration (that's decided per-category by whichever module
    owns it — e.g. fee-structure changes might reasonably need HOD,
    not just principal). Flagged in the route's own comment as worth
    revisiting once a real category has real business rules about who
    can change it, rather than guessing broader access is safe now.
  - `404` on `GET` for an unset category, `409` on a version conflict,
    standard Pydantic `422` on a malformed body — never a raw
    constraint-violation `500`.
- [x] CI pipeline (`.github/workflows/ci.yml`) — GitHub Actions,
      triggers on push/PR to `main`. A bare `postgres:16` `services:`
      container, **not** docker-compose, which matters: GitHub does
      not mount `docker/postgres/init/*.sh` as
      `docker-entrypoint-initdb.d` the way docker-compose's volume
      mount does — that only happens for docker-compose. The workflow
      runs `01-app-role.sh`/`02-platform-role.sh` explicitly as a
      step, once the service's own health check passes, connecting
      over TCP (`PGHOST`/`PGPORT`/`PGPASSWORD` env vars picked up by
      `psql` automatically — the scripts themselves needed no changes),
      then `alembic upgrade head`, then `pytest`. A `ruff check backend`
      step runs first per `backend/pyproject.toml` (permissive
      baseline: `E`/`F`/`W` only, line-length ignored) — one pre-
      existing unused import (`test_platform.py`) was the only finding,
      fixed rather than left for a future retroactive cleanup.
  - All CI env vars (`POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, etc.) are
    plain values in the workflow's `env:` block, deliberately not
    GitHub Secrets — they only ever exist inside an ephemeral CI
    Postgres container destroyed at the end of the run, so there is no
    confidentiality property to protect. Never reuse these values
    anywhere real; `.env`/`.env.example` remain the only place real
    secrets are generated.
  - `act` was not used to execute the workflow (not installed, and
    installing it means fetching an arbitrary binary from the
    internet — didn't do that without asking first). Instead did the
    documented fallback: manually ran the exact command sequence the
    workflow uses — fresh bare `postgres:16` container on a Docker
    network (not docker-compose), the two init-role scripts run from a
    separate throwaway container connecting over TCP with
    `PGPASSWORD` (mirroring an external CI runner, not an in-container
    trust-auth connection), `alembic upgrade head`, then the full
    `pytest tests/ -v` suite — all 68 tests passed. This confirms the
    *sequence* is correct independent of whether the YAML syntax is
    also accepted by GitHub's runner, which still needs a real push to
    confirm — see Known Limitations.

- [x] Principal invitation — **Option B** (invite-record-now,
      create-user-later), the decision from Known Limitations'
      two-option writeup, now built. Keeps `arcnave_platform`'s
      zero-grants-on-any-tenant-table property genuinely zero: the
      platform role creates an invitation row and nothing more; the
      principal's `users` row is created through the ordinary
      RLS-protected tenant write path, not a platform-side exception.
  - `backend/alembic/versions/0002_principal_invitations.py` — **the
    first genuinely new migration file since 0001.** Real git history
    now exists, so the "amend 0001" habit (justified only by "nothing
    has shipped yet") stops here; a new table is a new revision,
    chained via `down_revision`. `principal_invitations`: `id`,
    `college_id` (FK → `colleges`), `email`, `token_hash`, `created_by`
    (FK → `platform_admins`), `expires_at`, `accepted_at` (nullable —
    null means pending), `created_at`.
  - **No RLS on this table — deliberate, same structural reason
    `colleges` has none.** The entire point is being look-up-able by
    an opaque bearer token *before* any tenant context can possibly be
    known — the person accepting hasn't been resolved to a tenant by
    anything yet (no subdomain/JWT/account). An RLS policy keyed on
    `current_setting('app.current_tenant')` would fail closed to zero
    rows on every lookup, breaking the feature outright rather than
    securing it.
  - **Grants are directional, not symmetric** — `arcnave_platform` gets
    `SELECT, INSERT, UPDATE` (creates invitations; `UPDATE` reserved
    for a future revoke/resend, not built this pass); `arcnave_app`
    gets `SELECT, UPDATE` only, **no `INSERT`** — the tenant side only
    ever consumes an invitation (looks it up, marks it accepted), never
    creates one. That's enforced at the GRANT level, not just by which
    routes exist: even a bug in tenant-side code could not forge a new
    invitation row.
  - `POST /api/v1/platform/colleges/{college_id}/invite-principal`
    (`require_platform_admin`) — `{email}` → creates the invitation,
    returns the **raw token directly in the response body**, a
    temporary stand-in for actually emailing an accept-link
    (NotificationService doesn't exist yet — same pattern as
    password-reset's `501` stub, flagged in Known Limitations, not a
    real delivery mechanism). `404` if `college_id` doesn't exist
    (caught via the FK's `IntegrityError`, same pattern as
    `create_college`'s `DuplicateCollegeError`).
  - `POST /api/v1/invitations/accept` — **deliberately unauthenticated,
    the only tenant-side route in this codebase with no `require_role`
    dependency.** The caller has no `users` row yet; the invitation
    token itself is the one-time credential. `request.state.college_id`
    is `None` for essentially every real call here (no
    subdomain/JWT/explicit-code signal from someone who's never had an
    account) — expected, not an error; this route never reads it.
  - **The one deliberate, narrow bypass of `TenantMiddleware`'s normal
    resolution anywhere in this codebase.**
    `principal_invitation_service.accept_invitation` calls
    `set_tenant_context(db, invitation.college_id)` directly, using the
    `college_id` read off the (already token-authenticated) invitation
    row — not `request.state.college_id`. Documented explicitly, at
    length, in that function's docstring, precisely because it's the
    only place a route decides its own tenant scope rather than
    trusting what `TenantMiddleware` resolved.
  - Expired and already-accepted tokens are both rejected with the
    same generic `401` (`InvitationError`) — same
    don't-let-the-error-message-be-an-oracle reasoning as `AuthError`.
    Reuse of an already-*accepted* token additionally logs
    `principal_invitation_reuse_detected`, consistent with
    `auth_service.refresh`'s `refresh_token_reuse_detected` — a
    one-time credential being presented again after it's already been
    consumed is a signal worth recording, not just a routine reject.
    A merely-expired-but-never-accepted token does not log — same
    asymmetry `auth_service.refresh` already has between stale and
    reused refresh tokens.
  - On success: `role='principal'`, `is_active=true` immediately (the
    invitation itself *is* the activation — no separate approval step
    for the very first user of a college, since there's no one else to
    approve them yet), via a new `auth_repository.create_user` (a
    plain, generic INSERT — reusable by any future flow that needs to
    create a tenant user, not principal-invitation-specific).
  - Token generation/hashing reuses `app/core/security.py`'s existing
    `secrets.token_urlsafe(32)` + `hash_refresh_token` (SHA-256)
    pattern verbatim rather than duplicating it — an invitation token
    has the same threat-model shape as a refresh token (server-
    generated high-entropy randomness), so the same reasoning for
    SHA-256 over argon2 applies unchanged.
  - `docs/architecture/ERD.md` updated — `principal_invitations` is
    now the source-of-truth schema, not just the migration.

Repositories and services now exist for the auth slice
(`auth_repository.py`, `auth_service.py`), the platform slice
(`platform_repository.py`, `platform_service.py`,
`principal_invitation_repository.py`), and the configuration slice
(`configuration_repository.py`, `configuration_service.py`,
`audit_log_repository.py`), plus the tenant-side
`principal_invitation_service.py`. Every other tenant domain (Student,
Staff, Academic, ...) still has neither — those start with their own
module. **Every item on Module 0's build list is now done** — see
Known Limitations for deliberately deferred scope (NotificationService,
platform-admin bootstrap, MFA, etc.), none of which block Module 1
from starting.

## Business Rules

Pulled from `BusinessRules.md` / `Architecture.md`, scoped to this
module:

- Every tenant-scoped table has an RLS policy — not optional
  (ADR-002).
- RLS policies alone don't guarantee isolation: table owners and
  superusers can bypass them. `FORCE ROW LEVEL SECURITY` closes the
  owner bypass; only running the app as a separate, non-superuser DB
  role closes the superuser bypass. Migrations and runtime traffic
  never share credentials (ADR-015).
- `SET LOCAL app.current_tenant` (or the parameterized
  `set_config(..., true)` equivalent) must run inside the same
  transaction as the query it protects — never a bare connection-level
  `SET`, since pooled connections would leak tenant context across
  requests.
- `current_setting('app.current_tenant', true)` fails closed: a
  request that reaches the database without tenant context set sees
  zero rows, not an error.
- Super Admin / Platform operations never execute inside the
  RLS-scoped tenant path — they run through a completely separate
  Platform API with its own auth (ADR-010), now built as a genuinely
  separate ASGI sub-application (`app/platform_app.py`) with its own
  DB role (`arcnave_platform`) and JWT secret, mounted alongside (not
  inside) the tenant app. The schema keeps `platform_admins`/`colleges`
  free of RLS since Platform Admin never goes through the tenant
  request path that RLS protects.
- `colleges.college_id` (short human-readable code) is the tenant key
  used in `app.current_tenant` — deliberately distinct from
  `colleges.id` (internal UUID).
- Refresh tokens are stored as `token_hash` only — the raw token is
  never persisted, matching the ERD's `refresh_tokens.token_hash`
  column and standard practice for any bearer credential that grants
  ongoing access if leaked from a DB read.
- Login must use a real password-hashing scheme (argon2/bcrypt), never
  a placeholder — non-negotiable per this module's build instructions,
  consistent with treating credentials as a compliance-relevant asset
  the same way Aadhaar/PII handling is elsewhere in BusinessRules.md.

## Database Tables

See `docs/architecture/ERD.md` (source of truth) and
`backend/alembic/versions/0001_module_0_platform_foundation.py`
(implementation).

| Table | Schema group | RLS |
|---|---|---|
| `platform_admins` | Platform | No |
| `colleges` | Platform | No |
| `principal_invitations` | Platform-created, tenant-consumed | No — deliberate, see Features |
| `users` | Tenant | Yes |
| `refresh_tokens` | Tenant | Yes |
| `audit_log` | Tenant | Yes |
| `configurations` | Tenant | Yes |

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Liveness + DB connectivity check (no tenant required) |
| GET | `/api/v1/whoami` | Returns the resolved `college_id` for the request (400 if none resolves); exists to exercise Tenant Middleware end to end, not a real product endpoint |
| POST | `/api/v1/auth/login` | `{username, password}` → `{access_token, refresh_token, token_type}`. Tenant resolved by TenantMiddleware from subdomain/explicit code (no JWT exists yet at login time) |
| POST | `/api/v1/auth/refresh` | `{refresh_token}` → new token pair; rotates (old token revoked) |
| POST | `/api/v1/auth/logout` | `{refresh_token}` → 204; revokes it, idempotent |
| POST | `/api/v1/auth/password-reset` | Stub — always 501 |
| GET | `/api/v1/auth/me` | Requires a valid access token for any of staff/hod/principal (`require_role`); returns `{user_id, college_id, role}` from the token's claims |
| GET | `/api/v1/configurations/{category}` | Any authenticated tenant user. `404` if `category` has never been configured for this tenant |
| PUT | `/api/v1/configurations/{category}` | `principal` only. `{configuration, expected_version}` → `200` with the stored row, `409` on a version conflict |
| POST | `/api/v1/invitations/accept` | **Deliberately unauthenticated** — no `require_role`. `{token, username, password}` → `201` with `{user_id, college_id, username, role}`. `401` for an invalid/expired/already-accepted token, `409` if `username` is already taken within that tenant |

**Platform API** (`app/platform_app.py`, mounted at `/api/v1/platform`
— a separate ASGI app, not part of the tenant router above):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/platform/auth/login` | `{username, password}` → `{access_token, token_type}` (no refresh token — see Known Limitations) |
| POST | `/api/v1/platform/colleges` | Requires a valid platform token (`require_platform_admin`). `{college_id, name, subdomain}` → `201` with the created college (`subscription_status: "trial"`), or `409` on a duplicate `college_id`/`subdomain` |
| POST | `/api/v1/platform/colleges/{college_id}/invite-principal` | Requires a valid platform token. `{email}` → `200` with `{college_id, email, token, expires_at}` — the raw token, not an emailed link (see Known Limitations). `404` if `college_id` doesn't exist |

College-code generation policy and licensing/subscription management
are not built — see Known Limitations.

## UI Screens

None yet. Super Admin Portal screens (tenant provisioning) and the
tenant-side login screen are planned but not started.

## Permissions

Role model as defined in the ERD. Enforcement is now real, but
narrow — a single "must be authenticated as one of these roles" gate,
not a permission matrix:

- `platform_admin` — platform layer only, never authenticates against
  the tenant app (ADR-010). Enforced via `require_platform_admin`
  (`app/api/platform/deps.py`), structurally separate from
  `require_role`: decodes the token itself (the platform sub-app runs
  no `AuthMiddleware` to have already done it), checks
  `type == "platform_access"`, and is the only thing gating
  `POST /api/v1/platform/colleges` and
  `POST /api/v1/platform/colleges/{college_id}/invite-principal`.
  There is exactly one platform "role" — no permission matrix here
  either.
- `POST /api/v1/invitations/accept` — **the one route in this codebase
  with no auth dependency at all, on purpose.** The caller has no
  account yet; the invitation token in the request body is the
  credential, checked entirely inside
  `principal_invitation_service.accept_invitation`, not via any
  `require_*` dependency. Not an oversight — see Features.
- `staff` / `hod` / `principal` — tenant-scoped roles on `users.role`,
  carried into the access JWT's `role` claim at login. Enforced via
  `require_role(*roles)` (`app/api/deps.py`): a route lists which of
  these three roles may call it; `require_role(*TENANT_ROLES)` (used
  by `/api/v1/auth/me`) means "any authenticated tenant user."
  - `/api/v1/auth/me` (any tenant role) and `GET /api/v1/configurations/{category}`
    (any tenant role) prove the "authenticated, don't care which role"
    case. `PUT /api/v1/configurations/{category}` (`principal` only)
    is the first route that actually restricts to a role subset — but
    it's a conservative default, not a considered permission decision:
    BusinessRules.md doesn't yet say who should be able to change
    configuration, so this pass restricted to the most privileged known
    role rather than guess broader access is safe. Worth revisiting
    once a real category (e.g. fee structure, owned by a future Finance
    module) has an actual business rule about who can change it. No
    route yet distinguishes staff from hod specifically; that
    granularity arrives with each domain module (e.g. only HOD may
    assign a Class Tutor, per BusinessRules.md) as those routes are
    built.
  - Does not resolve BusinessRules.md's open question of whether
    "College Admin" should be a distinct role, or whether "Class
    Tutor" should be a role rather than a Faculty assignment —
    `require_role` enforces whatever role set a route is given: it
    takes no position on what that set should contain. Explicitly
    deferred to Module 2, per BusinessRules.md's own note.

## Tests

- [x] **Release-gating integration test** (ADR-002) —
  `backend/tests/integration/test_rls_tenant_isolation.py`. Connects
  as `arcnave_app` on a `pool_size=1` engine, seeds two tenants via
  the admin/migration connection, and on one physical connection
  (verified via `pg_backend_pid()`) proves: tenant A sees only its own
  row; a fresh transaction on the same connection with no tenant
  context set sees zero rows (fail-closed, not a leak of tenant A's
  row); tenant B then sees only its own row. Parametrized over both
  `commit` and `rollback` as the transaction-1 end mode — both must
  reset the `set_config(..., true)` scope. A negative control runs the
  same query as `arcnave_admin` and asserts it sees both tenants
  unfiltered, proving the isolation assertions above aren't vacuous.
  Passing against a live Postgres 16 container as of this writing.
- [x] **Tenant Middleware integration test** —
  `backend/tests/integration/test_tenant_middleware.py`. Hits
  `/api/v1/whoami` through a real FastAPI `TestClient` (not a raw SQL
  session, unlike the RLS test above) with varying `Host` /
  `X-College-Code` headers: subdomain resolution, explicit-code
  resolution, agreement when both sources match, rejection (400) when
  they conflict, rejection (400) when neither resolves, `/health`
  succeeding with no tenant at all, and a 6-request alternating-tenant
  sequence asserting no cross-request leakage. Proves the middleware
  wiring itself — resolution → `set_tenant_context()` →
  `request.state.db` → route handler — not just the RLS guarantee
  underneath it. Passing against a live Postgres container.
- [x] **Auth unit tests** — `backend/tests/unit/test_security.py`.
  Pure, no database: password hash/verify round trip and wrong-
  password rejection, access-token encode/decode round trip, and
  decode rejecting an expired token, a tampered signature, a token
  signed with the wrong secret, and outright garbage.
- [x] **Auth integration tests** — `backend/tests/integration/test_auth.py`,
  through a real `TestClient` against live Postgres: valid login
  issues both tokens (and the JWT's claims are checked, not just its
  presence); wrong password rejected; unknown username rejected;
  inactive account rejected; refresh rotates and the old token stops
  working; reuse of an already-revoked refresh token is rejected *and*
  asserted (via `caplog`) to emit the `refresh_token_reuse_detected`
  warning; logout revokes a token and a subsequent refresh with it is
  rejected; logout is idempotent for an unknown token; password-reset
  always 501s.
- [x] Tenant Middleware's JWT-claim resolution — covered in
  `test_tenant_middleware.py` (see Features above): resolves alone,
  agrees with a matching subdomain, and — the case explicitly called
  out when the TODO was completed — a JWT claiming tenant A combined
  with a subdomain resolving to tenant B correctly 400s rather than
  picking either one.
- [x] **RBAC tests** — `backend/tests/integration/test_rbac.py`, 8
  cases. Against the real `/api/v1/auth/me` route: no token → 401;
  malformed token → 401; expired token → 401; valid token → 200 for
  each of staff/hod/principal, with the response body checked against
  the token's actual claims. `/me` allows all three known roles, so it
  can't demonstrate role-*subset* rejection on its own — that's tested
  via a tiny throwaway `FastAPI()` app (not the production `app`),
  wired with the real `AuthMiddleware` + `require_role("hod",
  "principal")` on one route: a `staff` token correctly 403s, `hod`/
  `principal` tokens succeed, and no token still 401s. Passing against
  a live Postgres container (still required — TenantMiddleware runs
  for every request regardless of what the route needs).
- [x] **Request-scoped logging tests** —
  `backend/tests/integration/test_request_logging.py`, 7 cases.
  Captures real JSON text through the actual `JSONFormatter` (a
  temporary handler on the root logger, not `capsys`/`caplog` — see
  the file's module docstring for why `capsys` wouldn't reliably work
  here). Covers: `request_completed` line has `request_id`, omits
  `tenant_id`/`user_id` entirely (not as `null`) when unresolved;
  carries both when a real tenant/user resolve; `X-Request-ID` is
  generated and echoed on the response; an incoming `X-Request-ID`
  header is honored end to end into the log line; **five sequential
  requests get five distinct request_ids** — proven, not assumed,
  same discipline as the RLS test proving pooled-connection reuse
  rather than trusting the pool config; and — the one that actually
  validates the point of using contextvars — `auth_service.py`'s
  pre-existing `refresh_token_reuse_detected` warning (zero code
  changes to that file) picks up `request_id` automatically during a
  real login → refresh → reuse flow. Passing against a live Postgres
  container.
- [x] **Platform API tests** — `backend/tests/integration/test_platform.py`,
  11 cases against a live Postgres container:
  - Platform login succeeds / rejects wrong password / rejects unknown
    username; response has no `refresh_token` key at all.
  - College creation succeeds (`subscription_status: "trial"`); a
    duplicate `college_id` and a duplicate `subdomain` (against a
    *different* `college_id`) both `409`, not `500`; missing/no token
    `401`.
  - **Cross-boundary rejection** — the check that actually matters
    here: a platform token against `/api/v1/auth/me` (tenant,
    `require_role`-gated) → `401`; a real tenant access token against
    `/api/v1/platform/colleges` (`require_platform_admin`-gated) →
    `401`. Both fail at signature verification (different secrets),
    not at a role/type check that could be a weaker guarantee.
  - **Isolation proof.** First attempt used `monkeypatch.setattr()` on
    `TenantMiddleware.dispatch`/`AuthMiddleware.dispatch` with call
    counters — and it failed even on the positive-control tenant
    route, which was itself the finding: `BaseHTTPMiddleware` binds
    `self.dispatch_func = self.dispatch` once when the middleware
    stack is first built, so patching the class attribute afterward
    doesn't affect an already-constructed instance. The working
    version adds a test-only probe route directly to the real
    `platform_app` object (not a throwaway copy — proving something
    about what's actually mounted requires inspecting that exact
    object) reporting whether `request.state.college_id`/`jwt_claims`/
    `db` exist at all; since those are set *only* by
    `TenantMiddleware`/`AuthMiddleware` anywhere in the codebase, their
    total absence is conclusive. This test is what caught the
    single-app structure's middleware leak in the first place and
    passes against the current two-sub-app structure.
- [x] **ConfigurationService tests** —
  `backend/tests/integration/test_configuration.py`, 11 cases against
  a live Postgres container:
  - `GET` on an unset category `404`s; set-then-get round trip returns
    the same `configuration`/`version`.
  - A stale `expected_version` on an existing category `409`s; a
    non-`None`/non-`0` `expected_version` against a category that
    doesn't exist yet also `409`s; version increments correctly across
    three successive updates (1 → 2 → 3).
  - A write creates exactly one `audit_log` row
    (`action="configuration_updated"`, `entity_id=<category>`,
    `metadata.old_version`/`new_version` checked directly against the
    values).
  - RBAC: `staff`/`hod` `403` on write, no token `401` on write and
    on read, `staff`/`hod` `200` on read.
  - **Cross-tenant isolation, exercised through this specific code
    path** — two tenants both configuring the *same* category name
    (`shared_category_name`) each get an independent version-1 create
    (not a `409`/version-2 collision) and each only ever reads back
    their own value. Not assumed from `test_rls_tenant_isolation.py`
    already proving RLS in general — proven again here, since a bug
    specific to `configuration_repository.py` (e.g. forgetting the
    `college_id` filter, or a copy-paste college_id mix-up) wouldn't
    be caught by a test that never actually calls this code.
- [ ] Unit/integration tests for every other repository/service layer
  (Student, Staff, Academic, ...) — pending, not started until those
  modules exist.
- [x] **Principal invitation tests** —
  `backend/tests/integration/test_principal_invitation.py`, 8 cases
  against a live Postgres container:
  - Invitation creation requires a platform-admin token (`401`
    without one); succeeds and returns `{college_id, email, token,
    expires_at}`; `404` for an unknown `college_id`.
  - Accepting a valid invitation creates a user, and the tenant scope
    is verified **through RLS itself** — a second engine connecting as
    `arcnave_app`, explicitly `set_config`'d to each college in turn
    (same technique as `test_rls_tenant_isolation.py`), confirms the
    new user is visible under the invited college and invisible under
    an unrelated one, not just trusted from the response body. The
    created account is then proven to actually work by logging in
    through the ordinary `/api/v1/auth/login` path.
  - An expired token (seeded directly via the migration-owner
    connection, since the API always uses the configured default
    expiry) is rejected `401`.
  - Reusing an already-accepted token is rejected `401` **and**
    asserted via `caplog` to emit `principal_invitation_reuse_detected`
    — same proof technique as `test_auth.py`'s refresh-token-reuse
    test.
  - An unknown/garbage token is rejected `401`.
  - **Cross-tenant proof**: two colleges, two invitations, the *same*
    requested username — if either invitation's `college_id` ever
    leaked into the other's accept flow, the second accept would
    either `409` on the shared `(college_id, username)` constraint or,
    worse, silently create the row under the wrong college. Both
    succeed independently, and an RLS-scoped query per college
    confirms each landed under its own `college_id`, never the other's.
- [x] **CI pipeline verification** — not run via GitHub Actions itself
  (no remote exists yet), but the exact sequence
  `.github/workflows/ci.yml` runs was executed manually against a
  freshly created, non-docker-compose `postgres:16` container: role
  scripts over TCP with password auth → `alembic upgrade head` →
  `ruff check backend` (clean) → `pytest tests/ -v`. **68/68 passed**,
  same as every prior run, now proven against a Postgres instance
  provisioned the same way CI will provision one rather than assumed
  from docker-compose's different init mechanism.

## Known Limitations

- Repositories/services exist for the auth, platform, and
  configuration slices only. Every other tenant domain (Student,
  Staff, Academic, ...) still has neither — those are built when their
  own module starts, per the vertical-slice build order.
- **RBAC enforcement exists but is narrow.** `require_role(*roles)` is
  a working, tested mechanism, used by `/api/v1/auth/me` and both
  `/api/v1/configurations/{category}` routes. `/health`, `/whoami`,
  and all of `/auth/login`/`/auth/refresh`/`/auth/logout`/
  `/auth/password-reset` remain reachable anonymously — correct for
  all of them (you can't require a token to log in), not an oversight.
  No route yet distinguishes staff from hod specifically — the one
  role-*subset* restriction that exists (`PUT /api/v1/configurations/{category}`
  → `principal` only) is a conservative default pending a real
  business rule, not a considered permission decision — see
  Permissions.
- **Super Admin Portal API is platform auth + college creation only.**
  No refresh tokens for platform admins yet — login issues a single
  access token and nothing else; a deliberate scope cut (not built
  speculatively for a role that doesn't need session rotation yet), so
  a platform admin simply re-authenticates when the token expires. No
  `platform_admins` row can be *created* through any API yet either —
  the one used in tests/manual verification was inserted directly via
  the migration-owner connection; there is no "create the first
  platform admin" bootstrap flow.
- **No initial `platform_admins` row is seeded anywhere.** A fresh
  deployment has zero platform admins and no way to create the first
  one except a direct DB insert. Needs a decision (a seed script? a
  one-time bootstrap endpoint disabled after first use? a CLI command?)
  — not designed yet, flagging so it isn't forgotten. Principal
  invitation (below) doesn't help here: inviting a principal itself
  requires an already-authenticated platform admin.
- **Principal invitation is built (Option B — invite-record-now,
  create-user-later), but two things it depends on are still stubs:**
  - **No NotificationService.** `POST
    /api/v1/platform/colleges/{college_id}/invite-principal` returns
    the raw invitation token directly in the response body instead of
    emailing an accept-link — the same "flagged as a temporary stand-
    in" pattern already used for password-reset's `501`. Whoever calls
    this endpoint today has to relay the token to the principal
    out-of-band themselves.
  - **No revoke/resend flow.** `arcnave_platform`'s `UPDATE` grant on
    `principal_invitations` was added anticipating this, but nothing
    uses it yet — an invitation can't currently be cancelled or
    re-issued before it expires or is accepted.
  - Neither blocks Module 0 from being complete — both are the same
    kind of deliberate, documented scope cut as password reset's
    NotificationService dependency, not unfinished work.
- No college-code generation policy (`create_college` requires the
  caller to supply `college_id` directly; no uniqueness-friendly
  short-code generation, no format validation beyond the DB's `UNIQUE`
  constraint).
- No licensing/subscription management — `subscription_status`
  defaults to `'trial'` per the ERD and is never read or changed by
  anything.
- **ConfigurationService validates nothing about a category's
  contents.** Any authenticated tenant user can `GET` any category
  string, including ones that don't correspond to any real feature yet
  (e.g. `GET /api/v1/configurations/anything-i-typed` just `404`s,
  cleanly, rather than erroring). This is deliberate for Module 0 — the
  category enum and each category's JSON shape are decisions for
  whichever module owns that category — but it does mean there's
  currently no defense against a typo'd category name silently
  "succeeding" as a 404 instead of surfacing as a mistake, and no
  schema validation once a category *is* set. Both become relevant
  once a real category with real structure exists.
- **Refresh-token-reuse detection logs and rejects, but doesn't
  cascade.** Presenting an already-revoked refresh token is logged as
  a possible-theft signal, but only that one token stays revoked —
  the user's other active refresh tokens (if any exist from other
  sessions/devices) are untouched. Full session-family revocation on
  detected reuse is real, standard practice and a deliberate scope cut
  here, not an oversight — see Future Enhancements.
- Password reset is a stub (`501`) — needs NotificationService (email
  dispatch) and a reset-token flow, neither of which exist yet.
- `/api/v1/whoami` is a verification route for this module, not a
  real product endpoint — expect it to be removed or repurposed once
  there's a real "who am I" concept tied to RBAC.
- **No log rotation.** `setup_logging()` writes JSON lines to stdout
  only. Daily rotation (Architecture.md's observability section) is
  deliberately not application code — that's the deployment
  platform's job (Docker's own log driver, or whatever log aggregator
  sits downstream in production), not something to build here with no
  real destination to hand off to yet.
- **No error alerting.** Nothing pages or notifies on error-level log
  lines. Architecture.md lists "error alerts" as a goal, but building
  that now would mean wiring up infrastructure (PagerDuty, Slack
  webhook, email) with nowhere real to send it — deferred until an
  actual alerting destination exists.
- MFA hooks are out of scope for Module 0 per `Roadmap.md` (future
  work, not built now).
- ~~CI has never actually run on GitHub.~~ **Resolved 2026-07-03**:
  repo pushed to `https://github.com/sabarisv15/arcnave-blueprint`,
  `.github/workflows/ci.yml` triggered for real on GitHub's hosted
  runners and passed on both pushes since (commit `35c7293`, 50s;
  commit `ccd00f7`, 48s) — confirmed via the Actions tab, not just a
  successful `git push`. The `services:` Postgres container, the
  explicit `docker-entrypoint-initdb.d`-equivalent role-creation step,
  the migration step, and the full test suite all behave the same on
  GitHub's infrastructure as they did in the local manual walkthrough.

## Future Enhancements

- Redis + a real task queue (Celery/RQ/Dramatiq) only once bulk
  imports/notifications/OCR make `BackgroundTasks` insufficient — see
  `Decisions-To-Revisit.md`.
- On detected refresh-token reuse, revoke every active refresh token
  for that user (not just the reused one) — the theft signal currently
  logs and rejects a single token; escalating to full session-family
  revocation is the natural next step once there's a way to notify the
  affected user their session was forcibly ended.
- MFA.
- Log rotation and error alerting (see Known Limitations) — once a
  real deployment target and alerting destination exist.
- College-code generation policy, licensing/subscription management,
  and a bootstrap flow for the first `platform_admins` row (see Known
  Limitations — principal invitation itself doesn't solve this, since
  it requires an already-authenticated platform admin to call it).
- Principal-invitation revoke/resend, once needed — `arcnave_platform`
  already has the `UPDATE` grant on `principal_invitations` this would
  use.
- Emailing the principal-invitation accept-link instead of returning
  the raw token in the API response, once NotificationService exists.
- Refresh tokens for platform admins, if session length ever becomes
  a real usability problem — not built speculatively now.
- Category-specific configuration validation (JSON schema per
  category) and a known-category enum, once real categories with real
  shapes exist — see Known Limitations.
- Revisit `PUT /api/v1/configurations/{category}`'s `principal`-only
  restriction once a real category has an actual business rule about
  who should be able to change it.
- Custom domains (ADR-013) — deferred past initial launch.
