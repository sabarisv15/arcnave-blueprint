# TASK

## Objective
**Module 0 (Platform Foundation), UI slice — not Module 1.** The
Student UI slice can't proceed until this exists: nothing in the
frontend currently obtains or sends a real JWT, so no page can call
any `/api/v1/...` route yet. Scope here is strictly "make login work
against the real backend and make the token available to future
slices" — not a general frontend rewrite. Every other page
(`HodDashboard.jsx`, `TutorClass.jsx`, `StaffDashboard.jsx`, etc.)
keeps calling its old prototype endpoints untouched; repointing those
is each their own future slice, module by module.

## Files likely affected
- `frontend/src/App.jsx` (auth context: `login`, `logout`, session
  restore on load)
- `frontend/src/pages/Login.jsx` (one simplification — see below)

## Context — what's actually there today (checked, not assumed)
- `App.jsx`'s `login()` currently POSTs `/api/auth/login` (old
  prototype, cookie-session-based) and expects `{ user }` back. The
  real backend (`routes/auth.js`) is `/api/v1/auth/login`, POST
  `{ username, password }`, returns
  `{ access_token, refresh_token, token_type }` — a bearer JWT, not a
  cookie session. Error bodies are `{ detail: ... }`, not `{ error: ... }`
  — every route in this codebase uses `detail` consistently; fix the
  `err.error` reads too.
- Tenant resolution (`middleware/tenant.js`) checks, in priority
  order: subdomain → JWT claim → `X-College-Code` header, and 400s on
  disagreement between sources. Local dev has no real subdomain
  routing, so: send `X-College-Code: <the code the user typed>` on
  the `/auth/login` call itself (no JWT exists yet, so subdomain/JWT
  both fail to resolve and the header is the only source). Do **not**
  keep sending it on requests made after login — once a valid JWT
  exists, its `college_id` claim resolves the tenant on its own, and
  sending a stale/mismatched header alongside a valid token would hit
  the 400 mismatch-conflict path for no reason.
- `GET /api/v1/auth/me` (already built, `requireAuth`-gated) returns
  `{ user_id, college_id, role }` from the verified JWT claims — use
  this to populate `user` state after login and on page-load session
  restore, replacing whatever shape `{ user }` used to have.
- **No public "look up a college by code" endpoint exists yet** —
  `POST /colleges` is `requirePlatformAdmin`-gated (creating colleges,
  not looking one up), and there is no unauthenticated equivalent.
  Deliberate scope decision for this slice: **don't build one.**
  `Login.jsx`'s step 1 currently round-trips to `/api/colleges/code/:code`
  to show a "College Verified: `<name>`" confirmation before step 2 —
  drop that round-trip. Step 1 just collects the code and advances to
  step 2; the code gets validated implicitly when step 2's actual
  login call runs (a bad code surfaces as a 400 "No tenant could be
  resolved for this request" from `tenantMiddleware`, distinguishable
  from a 401 wrong-password). This is the one intentional UX
  regression in this slice — flag it as such, don't silently drop it
  without saying so.
- Refresh-token rotation / silent-refresh-on-401 is explicitly **out
  of scope** here. Store the `refresh_token`, use it for `logout()`'s
  revoke call, but don't build an auto-refresh interceptor — that's
  its own slice if/when access-token expiry actually becomes a
  problem in practice.

## Exact changes

**`App.jsx` — `login(username, password, collegeCode)`**:
- POST `/api/v1/auth/login`, headers include
  `X-College-Code: collegeCode`, body `{ username, password }`.
- On success: store `access_token`/`refresh_token` (localStorage,
  fixed keys — this is a real persisted app, not a Claude artifact;
  normal SPA token-persistence practice applies here). Call
  `GET /api/v1/auth/me` with the new token to populate `user` (
  `{ user_id, college_id, role }`) — don't trust a shape decoded
  client-side from the JWT itself, ask the server, same as the
  existing `/whoami`-style verification discipline elsewhere in this
  backend.
- On failure: read `err.detail`, not `err.error`.

**`App.jsx` — session restore on load**: if a stored `access_token`
exists, call `GET /api/v1/auth/me` with it. 200 → populate `user`,
stop showing the loading spinner. 401 (expired/invalid) → clear
stored tokens, treat as logged out — don't loop or retry.

**`App.jsx` — `logout()`**: POST `/api/v1/auth/logout` with
`{ refresh_token: <stored refresh token> }` in the body (the new
backend needs it to revoke; the old one didn't). Clear localStorage
and `user` state regardless of the response — logout is idempotent
client-side too, same spirit as `authService.revoke`'s
server-side idempotence.

**Expose the token for future slices**: whatever `useAuth()` returns
today (`user`, `login`, `logout`, `loading`), add `accessToken` to it.
The next slice (Module 1's actual UI repoint) needs this to attach
`Authorization: Bearer <token>` to `/api/v1/students` calls — don't
make that slice re-derive token storage from scratch.

**`Login.jsx`**: remove the `/api/colleges/code/:code` fetch call and
the "College Verified" step-1 confirmation UI (per the scope decision
above); step 1 becomes a plain "collect the code, go to step 2" form.
Keep the two-step shape (code, then credentials) — just drop the
server round-trip in between.

## Acceptance criteria
- Login with a real seeded user (principal/staff/hod) against a live
  DB succeeds end-to-end: token stored, `user` populated with the
  real role from `/auth/me`, redirect-by-role logic (already in
  `App.jsx`, untouched) fires correctly.
- Wrong password → visible error from `err.detail`, not a silent
  failure or `undefined`.
- Wrong/unknown college code → distinguishable error (400, "No tenant
  could be resolved"), not confused with a wrong-password 401.
- Page reload while logged in restores the session from the stored
  token without forcing re-login.
- Logout clears state and actually revokes the refresh token
  server-side (verify the row's `revoked_at` gets set, don't just
  trust the 204).
- No other page's fetch calls touched — every other `/api/...`
  (non-`v1`) call in the frontend is untouched, out of scope.
