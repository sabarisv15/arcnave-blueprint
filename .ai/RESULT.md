# RESULT

## Files changed
- `frontend/src/pages/TutorClass.jsx`

No backend files touched — matches this slice's own UI-only scope.

## What was built
`fetchData` was split into two independent, separately-try/caught
functions:
- **`fetchStudents()`** — repointed from the dead `/api/tutor-students`
  prototype endpoint to the real `GET /api/v1/students?limit=200`,
  with the `Authorization` header the route requires. Same field
  normalization as before (`name`/`roll_number`/`gender`/`entry_type`/
  `attendance`/`sem2_grade`/`sem2_result` fallback chains, unchanged),
  which already happened to handle real snake_case field names
  gracefully via their existing `||` fallbacks. Sets `isFallback` based
  on whether *this* call succeeded.
- **`fetchClassSettings()`** — the old `/api/tutor/class-settings` call,
  moved verbatim into its own function, deliberately **not** repointed
  (no real backend route exists — `TutorClass.jsx`'s main timetable
  display was already flagged out of scope in `dbe8380`).

`fetchData` now runs both via `Promise.all([fetchStudents(), fetchClassSettings()])`
— no longer a single combined try/catch gating one on the other's
success.

## The blocking problem this slice actually had to solve
Grepped `backend/src/routes/` for every prototype endpoint
`TutorClass.jsx` calls (`/api/tutor-students`, `/api/tutor/class-settings`,
`/api/tutor/live-attendance`, `/api/tutor/invitations/*`) — **none of
them exist.** Confirmed the direct consequence: the old code's
`if (studRes.ok && settingsRes.ok)` gate has been unconditionally false
for every real user since Module 1 — this screen has never shown real
student data. Simply changing the student fetch's URL while keeping
that combined gate would have changed nothing observable: the settings
call would still always fail, and the catch block would still always
discard the (now-successful) student data in favor of
`FALLBACK_STUDENTS`. Decoupling the two calls was not a style
preference — it was the only way this repoint could have any real
effect at all.

## `isFallback`'s meaning narrowed, deliberately, consequences named
`isFallback` used to mean "did every data source on this page load for
real" (vacuously always `false`→`true`, i.e. always fallback, since
both calls always failed together). It now means specifically "did the
student roster load for real." Every other place in this file gated on
`isFallback` (`handleDeleteStudent`, `handleAcceptInvitation`,
`handleRejectInvitation`) still calls its own separate, equally-dead
prototype endpoint, unaffected by this slice. The behavior change is
narrow and specific: with real students now loading successfully,
those actions will take their non-fallback branch and hit a real fetch
failure (a raw error toast) instead of the graceful "(offline)" message
they always took before. This is the correct, honest surfacing of a
pre-existing gap (those endpoints were never real), not a new bug this
slice introduced — and not something this slice's scope (repoint the
*student* fetch) asked to fix.

## Verification
1. **`npm run build`**: succeeds cleanly, all 1510 modules transform,
   no errors.
2. **Live, chained end-to-end proof**, against the real `docker-compose`
   Postgres (no browser-automation tooling installed in this project —
   same limitation `e4eb36b` already documented, and confirmed again:
   no `chromium-cli`, no Playwright in `frontend/node_modules/.bin`):
   - Seeded a real tenant with a principal, a tutor, a class, and a
     `fee_structures` row.
   - Created a real student through `POST /api/v1/students` (the exact
     path `StudentEditorModal`'s own save already uses, per `c9b6248`)
     — not a direct DB insert, to prove the real row shape a genuine
     "Add Student" action produces.
   - Logged in as the tutor and issued the *exact*
     `GET /api/v1/students?limit=200` request `fetchStudents()` now
     makes, then ran `fetchStudents()`'s own normalization function
     (copied verbatim into the verification script) against the
     response — confirmed the created student's real UUID `id` comes
     back and survives the mapping untouched (the mapping spreads `...s`
     first and never overwrites `id`).
   - Took that real `id` and issued the *exact* two requests
     `StudentEditorModal`'s Finance step makes
     (`GET /finance/fee-structures`, `GET /finance/fee-payments?student_id=...`)
     — confirmed the merge correctly resolves the `Tuition` category to
     `not_paid` for a student who's never been marked.
   - Issued the *exact* mark-paid request
     (`POST /finance/fee-payments`) with that same real id — got a real
     `200` with `status: 'paid'` back, proving the full chain (real
     roster → real id → Finance step → mark-paid) actually works
     end-to-end for the first time.
   - All seeded data cleaned up afterward; confirmed `0` rows in
     `colleges` post-run.
3. No backend files touched — no backend test run needed; this slice
   changed nothing the backend suite covers.

## Flags / open questions (restated or newly surfaced)
- **`TutorClass.jsx`'s roster now shows every student in the tenant,
  not just this tutor's own class** — `students` carries no `class_id`
  FK (restated, now directly consequential here rather than abstract:
  every prior Finance slice already flagged this gap for its own
  reasons).
- **Real students show `0%` attendance and blank grades** — no
  attendance/grade join exists on `students`; the existing
  normalization's fallback chains already tolerate this gracefully
  (defaults to `0`/`''`), so nothing broke, but it's worth naming: this
  repoint makes the roster *real*, not *complete*.
- **`handleDeleteStudent`, `handleAcceptInvitation`,
  `handleRejectInvitation` remain on dead prototype endpoints** — out
  of scope for this slice; their offline-fallback branches will now be
  skipped for real students (see above), surfacing raw fetch-failure
  toasts instead. A future slice should repoint at least
  `handleDeleteStudent` to `DELETE /api/v1/students/:id` (which is
  real), since it's the one most likely to be exercised now that
  students are real.
- **`TutorClass.jsx`'s main timetable display and
  `TutorClassMonitor.jsx` remain unrepointed** — restated from
  `dbe8380`, unchanged by this slice.
