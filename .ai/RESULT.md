# RESULT

## Files changed
- frontend/src/pages/HodDashboard.jsx
- frontend/src/pages/PrincipalDashboard.jsx

## What changed, per file
- `HodDashboard.jsx`: `useAuth()` destructure gains `accessToken`
  (`const { logout, user, accessToken } = useAuth();`).
  `handleStaffFormSubmit` now branches on `editingStaff` at the top:
  - **Edit branch (new)**: `PUT /api/v1/staff/${editingStaff._id ||
    editingStaff.id || editingStaff.staff_id}`, `Authorization: Bearer
    ${accessToken}` header, body mapped per the table in `.ai/TASK.md`
    (`name`->`full_name`, `staff_id`->`staff_code`,
    `phone_number`->`phone`, `joined_year`/`aicte_id` unchanged).
    Errors read `err.detail` (not `err.error`). On success: toast,
    close the modal, `loadData()` — does **not** set `generatedCreds`
    (the real response has no `username`/`password`; the existing
    `{generatedCreds && (...)}` JSX block and `{generatedCreds ?
    'Close' : 'Cancel'}` label needed zero changes — they already do
    the right thing when it's simply never set). The `linked_semester`
    -> `/api/hod/link-tutor` follow-up call is untouched, still keyed
    off `editingStaff.username`.
  - **Create branch**: unchanged behavior, still POSTs to
    `/api/hod/staff`, still sets `generatedCreds` from
    `data.credentials`. One cosmetic simplification: the body's
    `username: editingStaff ? editingStaff.username : undefined` had
    its now-dead ternary removed (this branch only ever runs when
    `!editingStaff`) — `username: undefined`, behaviorally identical
    (`JSON.stringify` drops `undefined`-valued keys either way).
- `PrincipalDashboard.jsx`: `useAuth()` destructure gains
  `accessToken` (`const { user, accessToken } = useAuth();`).
  `handleStaffFormSubmit` gets the same edit/create branch. Edit body
  additionally includes `department` (Hod's form has no department
  field; Principal's does). On success: toast,
  `setShowStaffModal(false)`, `loadData()` — does not set
  `generatedCredentials`. Create branch: byte-identical to before.

## The scope decision this slice made (see `.ai/TASK.md` for full reasoning)
`grep -rn "hod/staff" backend/src/` returns nothing — `/api/hod/staff`
doesn't exist in the Node backend at all, in either direction (GET
list or POST create). It already 404s against the real Express app
today. The prototype's single-endpoint flow also conflates two things
the real API keeps separate: creating a login account and creating a
staff profile — `staffService.createStaff` requires an
already-existing `user_id` and creates no account (Module 2's
first-slice scope decision, restated in every slice since). Building
account-creation is Module 0/Module 8 territory, not a UI repoint.

**Only the EDIT path was repointed.** CREATE stays on
`/api/hod/staff`, unchanged — still 404ing exactly as it did before
this slice, not a regression, not silently patched. Same "leave
what's out of scope alone" call `c9b6248` made for `TutorClass.jsx`.

## Tests
`vite build`: clean, no new warnings (same pre-existing chunk-size
notice as prior slices — confirms both files are still syntactically
valid JSX/JS).

No browser automation tool available in this sandbox (same constraint
as `c9b6248`), **and** the click-path is structurally unreachable
right now regardless: `staffList` is loaded via the still-un-repointed
`GET /api/hod/staff`, which 404s, so the "Edit" button never renders
against live data today. Verified instead by reproducing every HTTP
call the modal's `handleStaffFormSubmit` now makes byte-for-byte (URL,
method, headers, JSON body) against a **live** stack: the real
`docker-compose` Postgres (already running from prior Module 2
slices), the real Express backend (`node src/index.js`, port 5000,
real env vars), a real seeded tenant/principal/subject-staff account,
a real login issuing a real JWT.

1. **Seed** — created a real staff row via `POST /api/v1/staff` (the
   route this modal's PUT operates against) — 201.
2. **HodDashboard's exact edit body** — sent with `joined_year` as an
   *unconverted text string* (`"2021"`, matching the modal's actual
   `type="text"` input with no `parseInt`, unlike Principal's
   `type="number"` field): **200**, row updated correctly,
   `joined_year` came back as a real `number` (2021) — Postgres's
   parameter-binding coerced the numeric-looking string cleanly. No
   repeat of the marks-to-text-style bug the Module 1 UI slice found;
   checked for it deliberately given that precedent, and it isn't
   present here.
3. **PrincipalDashboard's exact edit body** (includes `department`,
   `joined_year` as a real JS number): **200**, `department` and
   `joined_year` both round-tripped correctly.
4. **Error path, real conflict** — `PUT` with a `staff_code` already
   taken by another row in the same tenant: real **409**,
   `{"detail":"staff_code \"CSE-42\" already exists for this
   college"}` — exactly the shape `err.detail` (not `err.error`) now
   reads.
5. **Error path, unknown id** — real **404**,
   `{"detail":"No staff found with id ..."}`.
6. **Audit attribution** — confirmed the `staff_updated` audit_log row
   is attributed to the authenticated principal's own user id, not
   the staff subject's — the `actorUserId`/`userId` distinction from
   the third slice holds through this real UI-driven path too (the
   route always used `{ userId: req.jwtClaims.sub }` for
   `updateStaff`, unaffected by that fix, but worth re-confirming
   end-to-end here since it's the first time a real caller-shaped
   request exercises it).
7. `git diff` confirms the CREATE branch in both files is untouched
   apart from the one dead-ternary simplification noted above in
   `HodDashboard.jsx`.
8. Backend process and all seeded test data (college, users, staff,
   audit_log rows) cleaned up after; verified via direct count queries
   afterward.

## Flags / open questions
- **CREATE is still fully broken** (pre-existing, not introduced here)
  — `/api/hod/staff` doesn't exist in the Node backend. Fixing it for
  real requires either (a) an account-creation endpoint this codebase
  doesn't have yet, or (b) adding a `user_id` input to this form and
  asking the HOD/Principal to already know an existing account's UUID
  — both out of scope for a repoint slice, both flagged rather than
  guessed at.
- **The GET loader (`/api/hod/staff` in both files' `loadData`) is
  still un-repointed** — `staffList` stays empty/erroring in the
  running app, so `editingStaff` can never actually be populated from
  real data yet, meaning this slice's new PUT logic — though verified
  correct against the real API — isn't reachable through the actual
  UI until a future slice repoints that loader too. Flagged, not
  solved here, matching `c9b6248`'s identical situation with
  `TutorClass.jsx`.
- **`/api/hod/link-tutor` remains untouched and still 404s** — Class
  Tutor assignment is Module 3 (Academic/timetable) territory per
  BusinessRules.md's already-resolved Module 2 decision, not a `staff`
  column; out of scope here by design, not an oversight.
- **No browser-level click-through verification was possible** — same
  sandbox constraint as `c9b6248`, compounded by the loader gap above
  making the click-path currently unreachable regardless. Recommend a
  manual pass once a future slice repoints the `GET` loader.
