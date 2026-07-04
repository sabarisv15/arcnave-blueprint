# RESULT

## Files changed
- `backend/src/services/collegeProfileService.js` (new)
- `backend/src/routes/collegeProfile.js`, `backend/src/routes/departments.js` (new)
- `backend/src/tenantApp.js` (+2 router registrations)
- `frontend/src/pages/CollegeAdminDashboard.jsx` (new)
- `frontend/src/App.jsx` (+route, +role redirect for `college_admin`)

No migration/repository changes — built entirely on the
already-committed schema from the prior slice.

## What was built
**Service**: `collegeProfileService.js` — `getProfile`/`updateProfile`
(thin wrappers over `collegeProfileRepository`, audit-logged) and
`listDepartments`/`getDepartment`/`createDepartment`/`updateDepartment`/
`removeDepartment` (validation: `name` required; `23505` on
`departments_college_id_name_key` mapped to `DepartmentNameConflictError`,
not a raw Postgres error).

**Routes**: `GET`/`PUT /api/v1/college-profile`,
`GET`/`POST /api/v1/departments`, `GET`/`PUT`/`DELETE /api/v1/departments/:id`
— all `requireRole('college_admin')`, both reads and writes (this
resource belongs to one role, unlike finance.js/staff.js's
requireAuth-for-reads convention).

**UI**: `CollegeAdminDashboard.jsx` (new — `college_admin` had no
dashboard at all before this slice), one "College Profile" tab: a form
for the 3 `colleges` columns + a departments list with an add/edit
modal, same card+list+modal convention `PrincipalDashboard.jsx`'s Fee
Structures tab uses. Wired into `App.jsx`'s router
(`/dashboard/college-admin`) and `IndexRedirect`'s role-based redirect.

## Verification
Full backend suite: 430/430, no regressions. An HTTP round-trip
script (one-off, deleted after use) proved: a `staff`-role token gets
403 on both resources; profile GET/PUT round-trips correctly; the
column-scoped grant from the prior slice still holds through this
route; department create/duplicate-name-409/missing-name-400/list/
update/get/delete/404-after-delete all correct. Then a real browser
(headless Chrome via `playwright-core`, same scratch install as the
prior slice, not added to this repo's dependencies) through the actual
login flow: filled and saved the college profile (toast + persisted
values), added a department (toast + appears in the list with its
approved intake). No console/page errors. Frontend production build
clean.

## Flags
- Bulk-provisioning (BusinessRules.md item 1) and template management
  (item 2) are separate, not-yet-built slices of the `college_admin`
  role — not touched here.
- No edit-department-in-place-without-modal or delete-confirmation UX
  polish — matches this codebase's existing minimal-first-slice UI
  convention (e.g. Fee Structures' own "create + list only" scope).
