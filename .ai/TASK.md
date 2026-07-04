# TASK

## Objective (Slice B of two independent follow-ups)
Build a simple admin screen (principal-only) to create/list
`fee_structures` (college/academic_year/class/fee_category/amount →
submitted for approval per `status`). API exists (`77dfcd0`), no
screen uses it. Match existing admin-screen conventions. No edit/delete
UI needed yet — create + list only.

## Grounding: which existing screen to match
Searched for "similar config/setup screens" before building anything.
`PrincipalDashboard.jsx` already has exactly this shape: a
`viewSection` tab (`'admin'`, labeled "Workload & Staff") that lists
data (staff directory, tutor assignments) fetched once in `loadData()`
on mount, plus an "Add Staff" in-page modal
(`showStaffModal`/`staffForm`/`openAddStaff`/`handleStaffFormSubmit`)
matching the `card p-6 space-y-4` section pattern, `p-3 bg-white
border border-slate-150 rounded-xl` list-item cards, and a
`modal-backdrop`/`modal-panel` form styled identically across every
admin action in this file. This is the closest, most consistent
surface to extend — added a new sibling tab, not a new page, not a new
visual pattern.

Also found a pre-existing, reusable `StatusBadge` component (module
scope, top of `PrincipalDashboard.jsx`) with `Approved`/`Rejected`/
generic-fallback branches — `fee_structures.status` values
(`'Pending Approval'`/`'Approved'`/`'Rejected'`) already match its
`Approved`/`Rejected` branches exactly, and `'Pending Approval'` falls
into its existing generic violet fallback. Reused verbatim, zero
changes to that component.

## Key design decisions
- **New `viewSection` tab, `'finance'`** (label "Fee Structures", icon
  `DollarSign` — already imported), sibling to `'admin'`, not nested
  inside it: Finance is its own module, not "Workload & Staff."
- **Data fetched in the existing `loadData()`**, alongside
  staff/classes/timetables/submissions — matching this component's own
  "fetch everything once on mount, all tabs read shared state"
  convention, not a per-tab lazy fetch (unlike Finance's own
  `StudentEditorModal` step, which lazily fetches because that modal's
  established convention is per-step local state).
- **Real API throughout**, unlike `staffForm`'s own create path (still
  the dead `/api/hod/staff` prototype endpoint, per `49c2c36`'s own
  scope boundary: `staffService.createStaff` needs a pre-provisioned
  `user_id` this UI can't supply). `financeService.createFeeStructure`
  needs nothing this form can't already provide, so there's no
  equivalent reason to leave it on a dead endpoint — `POST
  /api/v1/finance/fee-structures` is called directly.
- **No `status` field in the create form at all.** There is no real
  approval action to route this through yet (WorkflowService, Module
  8, doesn't exist — `financeService.js`'s own file comment). Every
  fee structure created here starts, and stays, `'Pending Approval'`
  (the real DB/service default) until a future slice builds an actual
  approve/reject action. Not worked around with a fake status picker.
- **Class name resolved via the already-loaded `classesList`**
  (`classesList.find(c => c.id === fs.class_id)`), same pattern the
  existing "Class Tutor Assignments" panel in the `'admin'` tab already
  uses to show `cls.class_name` — no new lookup mechanism invented.
- **Create + list only, no edit/delete UI** — per this session's own
  explicit scope.

## Files affected
- `frontend/src/pages/PrincipalDashboard.jsx`

## Verification
- `npm run build`: succeeds, all 1510 modules transform, no errors.
- Live app smoke via headless Chrome (`chrome.exe --headless --screenshot`):
  confirms the app still renders correctly after this change.
- **Live API-shape proof** against the real `docker-compose` Postgres
  (same substitute technique used throughout this Finance module when
  browser-automation tooling isn't available): seeded a real tenant +
  principal + class, then issued the *exact* requests
  `loadData()`/`handleFeeStructureFormSubmit` make — confirmed an empty
  initial list, a real `201` create defaulting to `'Pending Approval'`,
  the re-fetched list resolving the real class name via `classesList`,
  and a real `400` for a missing required field (matching the modal's
  own `required` attributes). All seeded data cleaned up.
- No backend files touched.
