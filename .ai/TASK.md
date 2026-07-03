# TASK

## Objective
Module 2 (Staff), fourth vertical slice: repoint `HodDashboard.jsx`'s
and `PrincipalDashboard.jsx`'s Add/Edit Staff modal (`staffForm`,
currently POSTing to `/api/hod/staff`) to the real `/api/v1/staff`
routes from `routes/staff.js`. Same process as `c9b6248`
(StudentEditorModal repoint).

## Grounding: this is not a pure field-rename job
Checked `backend/src/` before assuming anything: **no `/api/hod/*`
route exists anywhere in the Node backend.** `grep -rn "hod/staff"
backend/src/` returns nothing. This isn't "old backend, new backend,
pick the new one" — it's dead code today. Every request `staffForm`'s
submit handler currently makes (`GET /api/hod/staff`,
`POST /api/hod/staff`) already 404s against the real Express app
(Express's default HTML 404, not even a JSON body `err.error` could
parse). So this slice is a real fix, not a like-for-like swap.

## The deeper gap this task's framing undersells
The task description points at field-name mismatches (`phone` vs
`phone_number`, `staff_code` vs `staff_id`) — real, and listed below —
but there's a bigger one underneath: the prototype's `staffForm`
submit is a **single one-step flow that both creates a login account
and a staff profile**, returning generated credentials
(`generatedCreds`/`generatedCredentials`) immediately. The real
`POST /api/v1/staff` (via `staffService.createStaff`) does **not**
create accounts — it requires an already-existing `user_id` (Module
2's first-slice `.ai/TASK.md` scope decision, restated in every slice
since: "staff models an already-provisioned staff member... does not
build any part of the HOD/Principal approval chain or credential
generation"). There is no account-creation endpoint anywhere in this
codebase reachable from a staff-onboarding flow yet — building one is
Module 0/Module 8 territory, not a UI repoint.

**Decision: only the EDIT path is repointed to the real API. CREATE
stays on `/api/hod/staff`, unchanged, still broken exactly as it is
today** — not a regression, since it's already 404ing; not silently
patched over either. This is the same "leave what's out of scope
alone" call `c9b6248` made for `TutorClass.jsx` ("roster still won't
show newly-created students — expected... different backend/data
store entirely until a future module's slice repoints it"). Inventing
a `user_id` input field on this form, or building an account-creation
endpoint, would both be structure nobody asked for yet (CLAUDE.md
discipline) — flagged as the real, open, larger gap, not solved here.

A consequence of only repointing EDIT: `staffList` (loaded via the
still-un-repointed `GET /api/hod/staff`) will keep 404ing/returning
empty in the running app, so the "Edit" button per row never actually
renders against live data today — this repoint is only exercisable
once a future slice repoints that GET loader too. Same situation
`c9b6248` was already in for `TutorClass.jsx`; verification here uses
the same workaround (reproduce the exact fetch call against a live
stack directly, not by clicking through the actual dashboard, since
the click-path is unreachable regardless of this change).

## Files likely affected
- `frontend/src/pages/HodDashboard.jsx`
- `frontend/src/pages/PrincipalDashboard.jsx`

## Exact changes

**Both files**: add `accessToken` to the existing `useAuth()`
destructure (both already import `useAuth` from `'../App'` and use it
for other fields — `logout, user` in `HodDashboard.jsx`, `user` in
`PrincipalDashboard.jsx` — just missing `accessToken`, same as
`StudentEditorModal.jsx` needed).

**Field mapping, `staffForm` (camelish/prototype names) -> real API
snake_case body** (only what's sent for the EDIT/PUT path; CREATE's
body is untouched):
| `staffForm` field | real API field | notes |
|---|---|---|
| `name` | `full_name` | |
| `staff_id` | `staff_code` | Module 2's first-slice `.ai/TASK.md` already renamed this column deliberately — this is where that rename surfaces at the UI boundary. |
| `phone_number` | `phone` | |
| `aicte_id` | `aicte_id` | unchanged |
| `joined_year` | `joined_year` | unchanged |
| `department` (Principal only — Hod's form has no department field) | `department` | unchanged |
| `linked_semester` | *(none)* | drives a separate `/api/hod/link-tutor` call, untouched — Class Tutor assignment is Module 3 (Academic/timetable) territory per BusinessRules.md's already-resolved Module 2 decision, not a `staff` column. |

`user_id`/`college_id` are never in this mapping — a profile's account
link and tenant are set once at creation (which this slice doesn't
touch) and excluded from `staffService.updateStaff`'s
`ALLOWED_FIELDS` regardless.

**`HodDashboard.jsx`'s `handleStaffFormSubmit`**: branch on
`editingStaff`.
- Edit branch (new): `PUT /api/v1/staff/${editingStaff._id ||
  editingStaff.id || editingStaff.staff_id}` (same `_id || id ||
  <natural-key>` fallback convention `StudentEditorModal.jsx` used),
  `Authorization: Bearer <accessToken>` header, mapped body per table
  above. Error: `err.detail` (real API's error field, not `err.error`).
  Success: toast, close the modal, `loadData()` — **do not** set
  `generatedCreds`: the real `PUT` response is the repository's native
  staff row (no `username`/`password` — those live on `users`, which
  `staffService` never joins in). The existing JSX
  `{generatedCreds && (...)}` block and `{generatedCreds ? 'Close' :
  'Cancel'}` button label both need no change — they already do the
  right thing when `generatedCreds` is simply never set. The
  `linked_semester` -> `/api/hod/link-tutor` follow-up call is
  untouched, still keyed off `editingStaff.username` (the only place a
  username exists in this flow, since `staffService` doesn't return
  one).
- Create branch: **byte-identical to current code**, still POSTing to
  `/api/hod/staff`, still setting `generatedCreds` from
  `data.credentials`.

**`PrincipalDashboard.jsx`'s `handleStaffFormSubmit`**: same shape of
branch on `editingStaff`.
- Edit branch (new): `PUT /api/v1/staff/${editingStaff._id ||
  editingStaff.id || editingStaff.staff_id}`, `Authorization` header,
  mapped body (includes `department`, unlike Hod's). Error:
  `err.detail`. Success: toast, `setShowStaffModal(false)`,
  `loadData()` — do not set `generatedCredentials`.
- Create branch: byte-identical to current code.

## Acceptance criteria
- Both files' edit-path `fetch` calls reproduced byte-for-byte
  (URL, method, headers, body) against a live Express + real Docker
  Postgres stack: a real `staff` row updated via `PUT
  /api/v1/staff/:id`, response is the updated row, no 500/404 from a
  field-shape mismatch.
- `err.detail` (not `err.error`) is what reaches `showToast` on a
  real 400/404/409 from the edit path.
- CREATE path in both files is unmodified — confirmed via `git diff`
  showing zero changes to those lines.
- No other file touched (`TutorClass.jsx`, `/api/hod/link-tutor`,
  `/api/hod/classes` all untouched — genuinely out of scope, same as
  `c9b6248`'s treatment of `TutorClass.jsx`).
- No Aadhaar field anywhere (there never was one in this form).
