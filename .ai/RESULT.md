# RESULT

## Files changed
- `frontend/src/components/StudentEditorModal.jsx`

No backend files touched — matches this slice's own UI-only scope.

## The premise didn't match the codebase — surfaced before building anything
This session's instruction assumed an existing "student profile
screen" where Academic/Attendance had already added sections, "same
pattern." That doesn't exist here:
- `Profile.jsx` (`/profile`, `/profile/:username`) is a staff/tutor
  profile (staff_id, department, workload) — no student fields at all.
- `StudentEditorModal.jsx` is the only thing titled "Edit Student
  Profile," but it's a create/edit wizard, not a read view, and its
  existing "Academic" step means Module 1's prior-marks concept, not
  Module 3's Academic module. It has no Attendance step.
- No component anywhere shows a single student's profile with
  drill-down sections fed from real APIs.

Asked the user directly which surface to extend rather than guessing —
a wrong guess here risks building an entire feature on the wrong
screen. **Answer: `StudentEditorModal`'s step wizard.** Built there.

## What was built
Added a conditionally-appended `'Finance'` step to
`StudentEditorModal.jsx`'s wizard (`steps = isEditMode ? [...BASE_STEPS, { label: 'Finance' }] : BASE_STEPS`
— never shown when creating a new student, since `fee_payments.student_id`
needs a real id that doesn't exist yet).

The step itself:
- Fetches (lazily, only when the step is actually viewed) both
  `GET /api/v1/finance/fee-structures?limit=200` (the tenant's known
  fee categories — name, academic year, amount) and
  `GET /api/v1/finance/fee-payments?student_id=<id>` (this student's
  own marks), then merges them client-side: a fee category with no
  matching `fee_payments` row defaults to `not_paid`.
- Renders each merged row as a card (category name, academic year,
  amount) with a toggle button styled identically to this file's own
  existing `phoneVerified`/`parentPhoneVerified` verified-toggle
  buttons (emerald when "on," slate when "off") — no new visual
  pattern introduced.
- Toggling calls `POST /api/v1/finance/fee-payments` with
  `{ student_id, fee_structure_id, status }`, then re-fetches — the
  same upsert semantics `financeService.markFeePayment` already
  guarantees (works whether this fee line has ever been marked for
  this student before or not).
- Guards on `student.id` specifically (not `student._id || student.id`,
  the pattern `handleSave` uses elsewhere in this same file) — see
  below for why.

## Two reads, not one — a real API-shape constraint, not scope creep
The instruction named only "the fee_payments list-by-student
endpoint." That endpoint alone can't produce "fee categories... with
paid/not-paid status": `fee_payments` rows carry only a
`fee_structure_id` FK, no category name, no amount (`c1b7aac`'s ERD),
and there is no `GET /finance/fee-structures/:id` to resolve one row at
a time (`77dfcd0`'s own deliberate scope decision). The only way to get
a human-readable category name from the current API surface is the
existing plain `GET /finance/fee-structures` list (unscoped, since
students carry no `class_id` to scope it by — restated gap, see below).
Both calls already exist; nothing new was added to the backend.

## `student.id` vs `student._id` — the real, load-bearing distinction
Every real backend row carries `id` (every migration's PK column,
verbatim). `_id` is specifically the prototype-era field name
`FALLBACK_STUDENTS` and `/api/tutor-students`'s response shape still
use — and `TutorClass.jsx`, this modal's only real caller, has never
been repointed to `/api/v1/students` (checked: it still calls
`/api/tutor-students`/`/api/tutor/class-settings`, falling back to
`FALLBACK_STUDENTS` on any failure). So in practice, today, a student
object passed into this modal almost never carries a real `id` — the
Finance step's own guard (`!realStudentId` → "This student record
isn't linked to a real backend profile yet") is not a defensive
nicety, it's the expected, honest state of the world right now. Same
"correct given the real API, not yet reachable with real data" shape
`32f61bb`'s own StaffDashboard repoint already established for a
different (attendance) reason.

## Verification
1. **`npm run build`**: succeeds cleanly, all 1510 modules transform,
   no errors.
2. **Real app smoke, via headless Chrome**: started the actual Vite
   dev server and loaded it with
   `chrome.exe --headless --screenshot` — the app renders its real
   login screen (not a blank/broken frame), confirming this change
   didn't break the running app at a level a plain build check
   wouldn't catch.
3. **No interactive click-through of the Finance step itself** — two
   independent, honest reasons, not one excuse standing in for the
   other: (a) no Playwright/browser-automation tooling is installed in
   this project (checked: no `chromium-cli`, no `playwright` in
   `frontend/node_modules/.bin`), and (b) even with such tooling, the
   real interactive path is upstream-blocked regardless —
   `TutorClass.jsx` is still unrepointed, so there is no live route
   today that opens this modal with a real `student.id` to click
   through with. Recommending `/run-skill-generator` was considered
   and skipped: the blocker here is the missing tooling plus an
   upstream data gap, not a missing project-specific launch recipe.
4. **Live API-shape proof instead**, mirroring `32f61bb`'s own
   substitute technique: seeded a real tenant (via the admin pool) with
   a real student and two real `fee_structures` rows (`Tuition`,
   `Exam Fee`) against the live `docker-compose` Postgres, logged in as
   a real principal via `POST /api/v1/auth/login`, then issued the
   *exact* requests `fetchFeeData`/`handleToggleFeePayment` make (same
   URLs, headers, body shapes) directly against the running backend:
   - `GET /finance/fee-structures?limit=200` + `GET /finance/fee-payments?student_id=...`
     both `200`; merging them client-side-equivalent logic correctly
     defaults the unmarked `Tuition` row to `not_paid`.
   - `POST /finance/fee-payments` with `{student_id, fee_structure_id, status: 'paid'}`
     returns `200`; re-fetching and re-merging shows the row as `paid`.
   - Toggling back to `not_paid` re-marks the **same** `fee_payments`
     row (`id` unchanged) rather than creating a duplicate — proves the
     upsert semantics the toggle button depends on hold for real.
   - All seeded data cleaned up afterward (confirmed `0` rows in
     `colleges` post-run).
5. No backend files touched, no `npm test` run needed — this slice
   changed nothing backend-side, and the prior slice's 351/351 backend
   suite already covers the endpoints this UI calls.

## Flag: fee-structure admin UI is a real, separate follow-up need
Per this session's own explicit ask. `POST`/`PUT /finance/fee-structures`
exist at the API layer (`77dfcd0`, `requireRole('principal')`-gated)
but have **zero UI** anywhere in this application — there is currently
no screen where a Principal (or anyone) can create or edit a fee
category. This slice's Finance step only ever *reads*
`fee_structures` to populate category names in the merge; it never
creates or edits one, deliberately, per this session's own scope. A
real admin screen is a genuine, separate future slice, not attempted
here.

## Other flags / open questions (restated or newly surfaced)
- **The Finance step shows every tenant fee structure, not ones scoped
  to this student's class** — because `students` carries no `class_id`
  at all (restated gap from every prior Finance slice's own RESULT.md,
  directly relevant here now: a real "which fees apply to this
  specific student" view needs that FK to exist first).
- **RBAC mismatch, not resolved here**: the mark endpoint is
  Principal-only (`77dfcd0`'s own conservative placeholder), but the
  realistic actor toggling "has this student paid" from a profile
  screen is more plausibly a class tutor or accounts staff. Not
  duplicated/pre-empted client-side — a non-principal user will get a
  real 403 via the existing toast error path, same as any other fetch
  failure in this file. Revisit once a real role model exists (same
  flag `77dfcd0` already raised).
- **`TutorClass.jsx` itself remains unrepointed** — restated, not
  newly discovered (`32f61bb`'s own flag): until it calls
  `/api/v1/students` for real, no student passed into this modal will
  carry a real `id`, and the Finance step will show its "not
  available" message for every real user of this app today.
- **Scholarship eligibility / `annual_income` field** — restated,
  unchanged: still fully unbuilt.
