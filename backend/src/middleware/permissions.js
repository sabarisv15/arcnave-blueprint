'use strict';

// Central role -> permission mapping — replaces the flat, scattered
// requireRole('a', 'b') string-list checks every route embedded
// individually. PERMISSION_ROLES is the single source of truth: each
// entry lists exactly the roles requireRole(...) named at that route
// before this refactor (see the route comment on each line below), so
// this table reproduces existing access behavior exactly — a
// refactor, not a policy change. Any future change to "who may do X"
// is now a one-line edit here, not a hunt through route files.
//
// A static, code-level config, not a DB table: nothing in
// BusinessRules.md gives any tenant a reason to customize who holds
// which permission today — every role's capabilities are fixed
// platform-wide. A `role_permissions` table (with a migration) is the
// natural next step if/when a real per-tenant customization need
// shows up; a speculative migration for a need that doesn't exist yet
// would be exactly the premature complexity CLAUDE.md warns against.
//
// Permission names are `resource.action` (or `resource.subresource.action`),
// not `resource.write` — routes/actions that happen to share the same
// role set today (nearly everything here is principal-only) still get
// distinct names, because the entire point of a permission model is
// that one action's role set can change later without that change
// leaking into an unrelated action that happens to look identical
// today.

const PERMISSION_ROLES = {
  // routes/academicYears.js — BusinessRules.md Academic Year: "only the
  // Principal may request lifecycle transitions." Reads are requireAuth
  // (any authenticated tenant user), not gated here.
  'academic_years.create': ['principal'],
  'academic_years.activate': ['principal'],
  'academic_years.close': ['principal'],
  'academic_years.archive': ['principal'],

  // routes/analytics.js — GET /analytics/attendance-rate
  'analytics.attendance_rate.read': ['principal', 'hod'],

  // routes/backgroundJobs.js
  'background_jobs.create': ['principal'],
  // GET routes (this session's own task): background jobs are an
  // operational/internal concern (job status, error text) — no
  // BusinessRules.md rule names ordinary staff/hod as needing this,
  // same conservative-default reasoning finance.js's own writes use.
  'background_jobs.read': ['principal'],

  // routes/classes.js — POST/PUT/DELETE /classes
  'classes.create': ['principal'],
  'classes.update': ['principal'],
  'classes.delete': ['principal'],
  'classes.promote_semester': ['principal', 'hod'],

  // routes/collegeProfile.js — GET/PUT /college-profile. Moved from
  // college_admin to principal: college_admin is no longer a tenant
  // users.role (BusinessRules.md's College Admin — final model: an
  // ARCNAVE support employee, not a seat in any tenant's users table
  // — see Staff/Multi-tenancy). College profile maintenance is now a
  // Principal duty in-tenant.
  'college_profile.read': ['principal'],
  'college_profile.update': ['principal'],

  // routes/configurations.js — PUT /configurations/:category
  'configurations.update': ['principal'],

  // routes/calendar.js — POST/PUT/DELETE /calendar-events (task #20,
  // BusinessRules.md Platform administration, Academic Calendar).
  // Reads are requireAuth-only (any tenant user); writes are
  // Principal-only, same conservative default as configurations.update
  // above.
  'calendar.write': ['principal'],

  // routes/aiConfig.js — GET/PUT /ai-config
  'ai_config.read': ['principal'],
  'ai_config.update': ['principal'],

  // routes/departments.js — GET/POST/PUT/DELETE /departments. Moved
  // from college_admin to principal — see the college_profile note
  // above.
  'departments.read': ['principal'],
  'departments.create': ['principal'],
  'departments.update': ['principal'],
  'departments.delete': ['principal'],
  'hod_in_charge.appoint': ['principal'],

  // routes/documents.js
  'documents.upload': ['principal'],
  // Template upload moved from college_admin to principal — see the
  // college_profile note above.
  'documents.templates.upload': ['principal'],
  'documents.ocr.run': ['principal'],
  'documents.review': ['principal'],
  'documents.delete': ['principal'],

  // routes/facultyAllocation.js — POST/DELETE /faculty-allocation
  'faculty_allocation.create': ['principal'],
  'faculty_allocation.delete': ['principal'],

  // routes/finance.js
  'finance.fee_structures.create': ['principal'],
  'finance.fee_structures.update': ['principal'],
  'finance.fee_payments.create': ['principal'],

  // routes/notifications.js (Module 8 second slice — human-facing
  // route for the ledger) — same allowedRoles as the AI-tool path's
  // draft_notification/request_notification_send in aiToolRegistry.js,
  // so a human and an AI acting on a college's behalf have identical
  // reach; staff is excluded from both for the same reason: nothing in
  // BusinessRules.md's Notifications section names ordinary staff as a
  // drafter, only that drafts (human- or AI-origin) require Principal
  // approval before dispatch.
  'notifications.draft': ['principal', 'hod'],
  'notifications.submit': ['principal', 'hod'],
  'notifications.read': ['principal', 'hod'],

  // routes/classes.js — substitute assignment. BusinessRules.md names
  // the actor as "an authorized academic authority (HOD or
  // equivalent)" — HOD is the ordinary case, Principal as the
  // college-wide fallback authority, same pairing
  // analytics.attendance_rate.read already uses for a similarly-worded
  // "HOD or above" rule.
  'substitute_assignments.create': ['hod', 'principal'],
  // BusinessRules.md Automatic timetable generation names no actor for
  // triggering generation itself (only "HOD reviews and approves" the
  // result, already gated by the existing submit/approve chain) — same
  // conservative default other un-named-actor create actions in this
  // table use.
  'timetables.generate': ['principal', 'hod'],

  // routes/attendance.js — locking a session is an administrative
  // action (BusinessRules.md frames it as time-based/automatic, not a
  // named human actor — see attendanceService.lockAttendanceSession's
  // own comment); restricted to HOD/Principal rather than left open to
  // any authenticated user, pending a real scheduled-job trigger.
  // Correction submit/approve/reject are requireAuth, not gated here —
  // same "the service is the gate" reasoning the rest of this router
  // already uses for markAttendance.
  'attendance.lock': ['hod', 'principal'],

  // routes/curriculum.js — regulations/subjects are Principal-created
  // (BusinessRules.md doesn't name a different actor for this, same
  // conservative default other create/update/delete actions in this
  // table use); curriculum-migration submit/approve/reject are
  // requireAuth, not gated here — same "the service is the gate, not
  // requireRole" reasoning staff.js's submit-registration route uses.
  // routes/assessments.js — assessment types are institution-wide
  // configuration; mark entry/read/delete are requireAuth, gated by
  // assessmentService's own assigned-faculty check instead.
  'workflow_delegations.create': ['principal'],
  'archived_records.create': ['principal'],

  'assessment_types.create': ['principal'],
  'assessment_types.update': ['principal'],

  'regulations.create': ['principal'],
  'subjects.create': ['principal'],
  'subjects.update': ['principal'],
  'subjects.delete': ['principal'],

  // routes/reports.js — all three POST /reports/* routes shared one
  // requireRole('principal') each; one permission covers all three,
  // same as before.
  'reports.generate': ['principal'],

  // routes/staff.js
  'staff.create': ['principal'],
  'staff.hod_accounts.create': ['principal'],
  'staff.update': ['principal'],
  'staff.delete': ['principal'],

  // routes/students.js — students.create changed from ['principal'] to
  // ['staff']: BusinessRules.md's real rule is "the assigned Class
  // Tutor creates students for their own class," and Class Tutor is a
  // staff member (classes.tutor_user_id -> users.id, no separate
  // "tutor" role — see staffService.js's own comment that every role
  // other than hod/principal "passes through untouched" as 'staff').
  // This role check alone doesn't enforce "own class only" (that's
  // studentService.createStudent's job, resolving classes.tutor_user_id
  // = actorUserId itself) — it only excludes principal/hod, neither of
  // whom is ever a class's tutor_user_id in practice, from reaching
  // the route at all.
  'students.create': ['staff'],
  // students.update/delete changed from ['principal'] to
  // ['staff', 'hod', 'principal']: each is scoped to their own
  // boundary (tutor -> own class, hod -> own department, principal ->
  // own college) by studentService.assertCanModifyStudent, same
  // "role check here only narrows who reaches the route; the real
  // scope check lives in the service" split students.create already
  // established.
  'students.update': ['staff', 'hod', 'principal'],
  'students.delete': ['staff', 'hod', 'principal'],

  // routes/timetablePeriods.js
  'timetable_periods.create': ['principal'],
  'timetable_periods.import_csv': ['principal'],
  'timetable_periods.delete': ['principal'],
};

// Derived, not hand-maintained separately — keeping PERMISSION_ROLES
// as the one place a human edits avoids the two tables drifting apart
// the way the flat requireRole calls and this refactor's own audit
// just proved module docs already do.
const ROLE_PERMISSIONS = {};
for (const [permission, roles] of Object.entries(PERMISSION_ROLES)) {
  for (const role of roles) {
    if (!ROLE_PERMISSIONS[role]) ROLE_PERMISSIONS[role] = new Set();
    ROLE_PERMISSIONS[role].add(permission);
  }
}

function roleHasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role];
  return Boolean(perms && perms.has(permission));
}

module.exports = { PERMISSION_ROLES, ROLE_PERMISSIONS, roleHasPermission };
