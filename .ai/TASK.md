# TASK

## Objective
Module 5 (Finance), fifth vertical slice: UI only. API layer already
done (`77dfcd0`) — 5 endpoints under `/api/v1/finance/...`.

## Scope (this session's own instruction)
- Add a Finance section to the existing student profile screen, "find
  wherever Academic/Attendance already added their sections there,
  same pattern."
- List fee categories for the student with paid/not-paid status,
  calling the fee_payments list-by-student endpoint.
- Toggle/mark paid-not-paid action, calling the mark-paid endpoint.
- No fee-structure creation/management UI — separate admin screen,
  out of scope.
- Match existing profile section styling/conventions exactly.

## Pre-check: the premise didn't hold — surfaced, not guessed past
Before writing anything, searched for "wherever Academic/Attendance
already added their sections" on a student profile screen. It doesn't
exist:
- `frontend/src/pages/Profile.jsx` (routes `/profile`, `/profile/:username`)
  is a **staff/tutor** profile — staff_id, department, workload, linked
  classes. No student fields, no Academic/Attendance sections.
- `frontend/src/components/StudentEditorModal.jsx` is the only thing
  literally titled "Edit Student Profile," but it's a create/edit
  wizard for a student's own master-data fields, not a read view. It
  has an "Academic" *step* (prior SSLC/HSC/ITI marks — Module 1's own
  meaning of "academic," not Module 3's timetable/curriculum), but no
  "Attendance" step at all.
- No dedicated route/component anywhere shows a single student's
  profile with drill-down sections fed from real APIs — `TutorClass.jsx`
  only ever opens `StudentEditorModal` for editing.

Asked the user directly rather than guessing which surface to extend
(a wrong guess here means building UI in the wrong place entirely, not
a small correction). Chosen: **`StudentEditorModal`'s step wizard** —
add a 5th step, matching the existing step-tab pattern, even though the
modal is otherwise an edit wizard rather than a read view.

## Key design decisions
- **`BASE_STEPS` (unchanged: Upload Documents/Personal/Academic/Career
  Info) + a conditionally-appended `'Finance'` step**, computed as
  `const steps = isEditMode ? [...BASE_STEPS, { label: 'Finance' }] : BASE_STEPS`.
  Finance never appears when creating a new student — `fee_payments.student_id`
  is a real FK to `students.id`, and a new student has no id yet, same
  "no id yet, nothing to fetch" reasoning every other step's data
  being local form state already reflects.
- **Two real reads, not one**, even though this session's own framing
  names only "the fee_payments list-by-student endpoint":
  `fee_payments` has no `fee_category`/`amount` columns of its own
  (only a `fee_structure_id` FK — c1b7aac's ERD), and there is no
  GET-by-id for a single fee_structure (`77dfcd0`'s own explicit scope
  decision), so a human-readable category name can only come from also
  reading `GET /finance/fee-structures` (the existing plain, unscoped
  list, `?limit=200`). Merged client-side: a fee category with no
  `fee_payments` row yet defaults to `'not_paid'` — a row only exists
  once a mark has actually been made (`financeService.js`'s own file
  comment), so "no row" and "marked not paid" are indistinguishable,
  and treating an unmarked fee the same as an explicitly-unpaid one is
  the correct default.
- **`student.id` (not `student._id || student.id`) gates whether the
  Finance step can actually fetch anything.** Every real backend row
  carries `id` (every migration's PK column); `_id` is specifically
  the prototype-era field `FALLBACK_STUDENTS`/`/api/tutor-students`
  still use, since `TutorClass.jsx` (this modal's only real caller)
  hasn't been repointed to `/api/v1/students` yet. When `student.id` is
  missing, the Finance step shows a flagged "not available" message
  instead of firing a fetch with a bogus/absent id — same "correct
  given the real API, not yet reachable with real data" pattern
  `32f61bb`'s own UI slice already established for a different reason.
- **Toggle button styling reuses this file's own existing
  emerald/slate verified-toggle pattern** (the `phoneVerified`/
  `parentPhoneVerified` buttons a few steps earlier) rather than
  inventing a new visual language for "on/off."
- **RBAC is not duplicated client-side.** The mark endpoint is
  `requireRole('principal')`-gated (`77dfcd0`'s own conservative
  placeholder). The toggle button is shown to every role; a
  non-principal actor gets a real 403 surfaced via the existing
  `showToast(err.message, 'danger')` error path, same as every other
  fetch failure in this file — no new client-side authorization logic
  invented to pre-empt it.

## Files affected
- `frontend/src/components/StudentEditorModal.jsx`

## Verification
- `npm run build` (frontend): succeeds, all 1510 modules transform, no
  errors.
- Started the real Vite dev server and loaded the app in headless
  Chrome (`chrome.exe --headless --screenshot`) — confirms the app
  renders a real frame (login screen), not blank/broken, after this
  change.
- **No interactive click-through of the Finance step itself**: no
  Playwright/browser-automation tooling is installed in this project,
  and the real interactive path is upstream-blocked regardless —
  `TutorClass.jsx` is still on `/api/tutor-students` (unrepointed), so
  there is no live route today that opens this modal with a real
  `student.id`. Same limitation `32f61bb`'s own UI slice documented.
- **Live API-shape proof instead** (same substitute technique
  `32f61bb` used): seeded a real tenant + student + two real
  `fee_structures` rows against the live `docker-compose` Postgres,
  then issued the *exact* requests `fetchFeeData`/
  `handleToggleFeePayment` make (same URLs, headers, body shapes) —
  confirmed the merge defaults an unmarked category to `not_paid`,
  marking paid returns 200 and the row re-fetches as `paid`, and
  toggling back to `not_paid` re-marks the same row (not a duplicate).
- No backend files touched this slice.

## Flag: fee-structure admin UI needed as a separate follow-up slice
Per this session's own explicit ask. `POST`/`PUT /finance/fee-structures`
exist at the API layer (`77dfcd0`) but have **no UI at all** — there is
currently no way for anyone to create or edit a fee category through
this application short of a direct API call. This student-profile
Finance step deliberately only *reads* `fee_structures` (to populate
category names) and never creates/edits one, per this session's own
explicit scope. A real admin screen (likely Principal-only, given the
route's own RBAC) is a genuine, separate future slice — not attempted
here.
