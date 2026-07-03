# RESULT

## Files changed
- frontend/src/App.jsx
- frontend/src/pages/Login.jsx

## What changed, per file
- `App.jsx`: `login(username, password, collegeCode)` now POSTs
  `/api/v1/auth/login` with `X-College-Code` (only on this call — see
  Flags) and `{ username, password }`; on success it stores
  `access_token`/`refresh_token` under fixed `localStorage` keys, then
  calls `GET /api/v1/auth/me` with the new token to populate `user` as
  `{ user_id, college_id, role }` (never a client-decoded JWT shape).
  Failure reads `err.detail`. Session restore on load now reads a
  stored `access_token` and calls `/auth/me`: 200 populates `user`, 401
  clears both stored tokens and falls through to logged-out, no
  retry/loop. `logout()` POSTs `/api/v1/auth/logout` with
  `{ refresh_token }` **and an `Authorization: Bearer <access_token>`
  header** (added after live testing — see Tests/Flags), then clears
  `localStorage`/state unconditionally regardless of the response.
  `useAuth()` now also exposes `accessToken` for the next slice's
  `Authorization` headers. No other page's fetch calls touched.
- `Login.jsx`: removed the `/api/colleges/code/:code` lookup and its
  "College Verified" confirmation UI/state (`collegeInfo`, the async
  `handleCollegeCode`). Step 1 is now a synchronous "collect the code,
  advance to step 2" — no server round-trip. `handleLogin` passes
  `collegeCode.trim().toLowerCase()` straight to `login()` (same
  normalization the old code applied before its now-removed lookup
  call). Removed the now-unused `CheckCircle2` import. Two-step shape
  unchanged.

## Tests
Built with `vite build` after each change (clean, no warnings beyond
the pre-existing chunk-size notice). Then ran the actual login/logout/
session-restore flow against a **live** stack — a throwaway
`postgres:16` container migrated through all three existing
migrations, the real Express backend (`node src/index.js`) on port
5000, and the real Vite dev server on port 3000 (confirming its
existing `/api` → `localhost:5000` proxy actually forwards
`/api/v1/...`) — with a real seeded college (`demo`) and a real
`principal` user (argon2-hashed password, not a stub). No browser
automation tool (`chromium-cl`i/Playwright) was available in this
Windows sandbox — no Linux container/xvfb to run one — so the UI
wasn't driven through an actual rendered page; every fetch call
`App.jsx`/`Login.jsx` make was instead exercised directly via `curl`
against the identical URLs/headers/bodies the React code sends,
against the same live backend + DB the code will actually talk to.
This should be spot-checked in a real browser before shipping — flagged
below.

1. **Login success** — `POST /api/v1/auth/login` with `X-College-Code: demo`
   and the seeded principal's real credentials returns a genuine JWT;
   `GET /api/v1/auth/me` with that token returns exactly
   `{ user_id, college_id: "demo", role: "principal" }` — the shape
   `login()` uses to populate `user`.
2. **Wrong password** — same call with a bad password returns
   `{"detail":"Invalid username or password"}`, 401 — confirms
   `err.detail` (not `err.error`) is the right field to read.
3. **Unknown college code** — `X-College-Code: doesnotexist` returns
   `{"detail":"No tenant could be resolved for this request"}`, 400 —
   distinguishable from the 401 above, as required.
4. **Session restore** — `/auth/me` with a garbage/invalid token
   returns 401 (the path that clears stored tokens client-side).
5. **Logout / revoke — real bug found and fixed.** First attempt
   called `/auth/logout` with only `{ refresh_token }` and no
   `Authorization` header (matching the task's literal wording, which
   only specifies the body). `revoked_at` stayed `NULL` in the DB
   after a 204 response. Root cause: `refresh_tokens` has `FORCE ROW
   LEVEL SECURITY`; with no tenant resolved (no subdomain in local
   dev, no header), `app.current_tenant` is never set for that
   request's transaction, so RLS hides the row from
   `authService.revoke`'s lookup entirely — `revoke()` silently no-ops
   on a row it can never see, and the route still returns 204 either
   way. Fixed by sending `Authorization: Bearer <access_token>` on the
   logout call so `tenantMiddleware` resolves the tenant from the
   JWT's `college_id` claim, same as every other post-login request.
   Re-verified end to end: logged in, captured the refresh token,
   computed its SHA-256 hash independently (matching `security.js`'s
   `hashRefreshToken`), confirmed the row's `revoked_at` was `NULL`
   pre-logout, called `/auth/logout` with the `Authorization` header,
   and confirmed `revoked_at` was a real timestamp afterward —
   verified in the database directly, not just trusting the 204.
6. Confirmed no backend files changed (`git status --short backend/`
   empty) and no other frontend page's fetch calls were touched
   (only `App.jsx`/`Login.jsx` in the diff).

## Flags / open questions
- **Logout needed an `Authorization` header the task didn't literally
  specify** — the task's exact wording for `logout()` only mentions
  the `{ refresh_token }` body. Without the header, the call still
  "succeeds" (204) but silently revokes nothing, because of
  `refresh_tokens`' RLS policy (see Tests #5). Added the header since
  the alternative is a logout that doesn't actually log anyone out
  server-side — flagging in case there's a reason this was
  deliberately left out that I'm not seeing.
- **Dropped the college-verification round-trip, as instructed** —
  step 1 no longer confirms the college name before step 2; a bad code
  now only surfaces once the real login call runs, as a 400 distinct
  from a 401. This is the one intentional UX regression called out in
  the task, not something dropped silently.
- **Refresh-token rotation / silent-refresh-on-401 is out of scope, as
  instructed** — the refresh token is stored and used for the logout
  revoke call only; there is no auto-refresh interceptor. An expired
  access token today means the user has to log in again rather than
  being silently refreshed — acceptable per the task, revisit if
  access-token expiry (15 min, per `config.js`) becomes a practical
  problem.
- **No browser-level verification was possible in this sandbox** — see
  Tests above. Every fetch call was verified at the HTTP level against
  a real backend/DB, but the actual rendered `Login.jsx` flow (button
  clicks, step transitions, redirect-by-role) was not driven through
  a real browser. Recommend a manual click-through (or
  `/run-skill-generator` to capture a repeatable browser-driving setup
  for this repo) before considering this slice fully verified.
- **`vite.config.js`'s dev proxy target (`localhost:5000`) was not
  changed and was not in scope** — confirmed it does forward
  `/api/v1/...` correctly (tested directly), so no action needed, but
  noting it since the task's `/api/v1` paths only reach the real
  backend in dev because that proxy target happens to already be where
  this backend listens.
