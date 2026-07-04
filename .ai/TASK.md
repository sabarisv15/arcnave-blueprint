# TASK

## Objective (Slice A of two independent follow-ups)
Repoint `TutorClass.jsx`'s student-roster fetch to the real
`GET /api/v1/students` — `StudentEditorModal.jsx` was repointed to
`/api/v1/students` in Module 1 (`c9b6248`), but its only real caller,
`TutorClass.jsx`, never was. Student objects it passes into the modal
lack a real `id`, found while building Finance's UI step (`e4eb36b`).
Verify Finance's step in the modal now actually receives a real id and
works end-to-end.

## Grounding
Confirmed via grep before touching anything: `/api/tutor-students`,
`/api/tutor/class-settings`, `/api/tutor/live-attendance`,
`/api/tutor/invitations/*` all have **zero** matching routes anywhere
in `backend/src/routes/` — every one is a dead prototype endpoint that
always 404s. This means, today, `fetchData`'s existing
`Promise.all([studRes, settingsRes])` gate (`if (studRes.ok && settingsRes.ok)`)
**always** falls through to its catch block — every real user of this
app has always seen `FALLBACK_STUDENTS`, never real data, since Module 1.

`dbe8380` already repointed this file's `deptClasses` dropdown (HOD's
department-classes selector) to `GET /api/v1/classes`, and explicitly
flagged the main student roster (`fetchData`) and
`TutorClassMonitor.jsx` as out of scope for that slice. This session's
task is exactly that flagged gap.

## The blocking design problem, found and solved
Repointing only the student half of `fetchData` while keeping the
existing combined `Promise.all` gate would have been a no-op: the
settings call (`/api/tutor/class-settings`) has no real route and will
never succeed, so `if (studRes.ok && settingsRes.ok)` would still
always take the catch branch and discard real student data in favor of
`FALLBACK_STUDENTS`, forever. Fixed by splitting `fetchData` into two
independent, separately-try/caught functions — `fetchStudents()`
(repointed, real) and `fetchClassSettings()` (unchanged, still dead) —
run via `Promise.all([fetchStudents(), fetchClassSettings()])` but no
longer gating each other's success.

## Key design decisions
- **`isFallback` now means "the student roster came from
  `FALLBACK_STUDENTS`,"** not "did every data source on this page
  succeed." This is the one thing this slice's own scope (repoint the
  student fetch) asked to change. Every other `isFallback`-gated action
  in this file (`handleDeleteStudent`'s offline filter,
  `handleAcceptInvitation`/`handleRejectInvitation`'s local-only
  fallback) still targets its own equally-dead prototype endpoint
  either way — with real students now loaded, those actions correctly
  route into their non-fallback branch, which will surface a real
  fetch error instead of a graceful "(offline)" message. This is an
  honest consequence of making real data reachable for the first time,
  not a regression introduced or owed to this slice — those endpoints
  were never repointed and aren't in scope here. Flagged, not silently
  left for someone to discover as a surprise later.
- **No class-scoping**: `GET /api/v1/students` has no filter beyond
  `limit`/`offset` — `students` carries no `class_id` FK at all
  (restated gap, every prior Finance slice already flagged this
  repeatedly for its own reasons). This repoint necessarily shows every
  student in the tenant, not just this tutor's own class roster.
  `?limit=200` is a generous, flagged cap, same as Finance's own UI
  step used for its unscoped fee-structures list.
- **Real students will show `0%` attendance and blank grades** — the
  normalization's existing fallbacks (`s.attendance || ... || 0`,
  `s.sem2_grade || ... || ''`) already handle this gracefully; `students`
  carries no attendance/grade columns (that's Module 4's
  `attendance_sessions`, not joined here). Not a bug introduced by this
  repoint — an existing, honest gap the pre-existing code already
  tolerates.
- **`handleDeleteStudent`'s DELETE call remains on the dead
  `/api/tutor-students/:id` endpoint**, untouched — out of scope, same
  as `dbe8380`'s own scope boundary. With real students now loaded
  (non-fallback), clicking delete will surface a real fetch failure
  instead of the previous always-taken offline branch — again, an
  honest exposure of an existing gap, not a new one.

## Files affected
- `frontend/src/pages/TutorClass.jsx`

## Verification
- `npm run build`: succeeds, all 1510 modules transform, no errors.
- **Live, chained end-to-end proof** against the real `docker-compose`
  Postgres (no browser-automation tooling installed in this project,
  same limitation `e4eb36b` already documented): seeded a real tenant
  with a tutor, a principal, a class, and a `fee_structures` row; created
  a real student through `POST /api/v1/students` (the same path
  `StudentEditorModal`'s save already uses); called the *exact*
  `GET /api/v1/students?limit=200` request `fetchStudents()` now makes
  and ran its own normalization function against the response —
  confirmed the real UUID `id` survives untouched; took that id and
  ran it through the *exact* two calls `StudentEditorModal`'s Finance
  step makes (`fetchFeeData`), confirming a correct merge; then called
  the *exact* mark-paid request, confirming `200` end-to-end. All
  seeded data cleaned up afterward.
- No backend files touched.
