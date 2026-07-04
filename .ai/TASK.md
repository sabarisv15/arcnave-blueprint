# TASK

## Objective (College Admin profile, next slice)
Service + API + UI. `collegeProfileService` (get/update the 3
`colleges` columns, CRUD on `departments`) — `college_admin` role only.
Routes under `/api/v1/college-profile`, `/api/v1/departments`. UI: new
"College Profile" tab, same dashboard conventions as Fee Structures.

## Scope
Built on the already-committed migration/repositories
(`collegeProfileRepository.js`/`departmentRepository.js`,
`1753000000000_college-admin-profile-schema.js`). No schema change.
`college_admin` is a brand-new role with no existing dashboard — added
one (`CollegeAdminDashboard.jsx`), routed at `/dashboard/college-admin`.

## Constraints
- BusinessRules.md's College Admin resolution, item 3: this is this
  role's own ongoing duty, not shared with Principal.
- `requireRole('college_admin')` on every route, both reads and
  writes — unlike finance.js/staff.js's requireAuth-for-reads
  placeholder, this whole resource belongs to one role.

## Verification
Live: full backend suite + an HTTP round-trip script (RBAC 403 for a
non-college_admin role, GET/PUT profile, department create/conflict/
validation/list/update/get/delete/404-after-delete) — then a real
browser (headless Chrome via `playwright-core`, same scratch install
as the prior slice) through the actual login flow, filling the
profile form and adding a department.
