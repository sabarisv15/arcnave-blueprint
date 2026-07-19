'use strict';

// Business logic for Module 3's `classes` table — validation and
// audit logging on top of classRepository.js, which does neither
// (CLAUDE.md rule 1: AI tools call Business Services, never
// repositories directly — this file is what makes that possible for
// classes).
//
// This slice is plain CRUD + validation, same shape as
// staffService.js's second slice: no HOD/Principal review-chain
// transition logic ('Pending HOD' -> 'Approved'/'Pending
// Principal'/'Rejected', per HodDashboard.jsx/PrincipalDashboard.jsx's
// handleTimetableReview) is enforced here beyond validating that a
// given timetableStatus is one of the known literals. CLAUDE.md rule
// 3: WorkflowService is the sole approval gate, and it doesn't exist
// yet (Roadmap.md builds Workflow/Notifications after Attendance/
// Finance/Documents/Reports) — same "out of scope here, not stubbed"
// reasoning studentService.js used for the HOD-override exception.
// "Class Tutor is assigned only by HOD" (BusinessRules.md Staff) is an
// authorization rule, left to the route/RBAC layer once Module 3's API
// exists, matching staffService.js's precedent for "only HOD/Principal
// may add staff."
//
// Faculty allocation (assignFacultyAllocation and friends) lives in
// this same file, not a new service: Architecture.md 2.5's own
// Business Services table lists "faculty allocation" as part of what
// AcademicService owns, alongside "timetable" — not inferred, stated
// outright. facultyAllocationRepository.js/timetablePeriodRepository.js
// were added purely additively (classes.timetable_data untouched — see
// that slice's .ai/TASK.md) specifically to give AttendanceService's
// "scheduled staff member" gap (attendanceService.js, 82f8479) a real,
// structured link — surfacing the migration's own uniqueness rules as
// domain errors, same pattern as classRepository's own constraints
// above. No authorization check on assign/remove: BusinessRules.md
// names no specific actor for "who may assign faculty," unlike "Class
// Tutor is assigned only by HOD" — left to the route/RBAC layer once
// an API exists, not invented here.
//
// getTimetablePeriod/getFacultyAllocationForClassAndPeriod are the two
// read-only lookups attendanceService.markAttendance now composes
// (client, day-of-week, hour_index) -> a shared period ->
// (class, period) -> who's allocated to teach it — to verify
// BusinessRules.md Attendance's third eligible marker, "the staff
// member scheduled for that period." See attendanceService.js for the
// composition; this file only exposes the two lookups it's made of.

const classRepository = require('../repositories/classRepository');
const facultyAllocationRepository = require('../repositories/facultyAllocationRepository');
const timetablePeriodRepository = require('../repositories/timetablePeriodRepository');
const timetableRevisionRepository = require('../repositories/timetableRevisionRepository');
const substituteAssignmentRepository = require('../repositories/substituteAssignmentRepository');
const visibilityService = require('./visibilityService');

// Calendar order for a free-text day_of_week column (see
// timetablePeriodRepository.findAllByCollege's own comment) — a
// six-day working week, matching the CSV import slice's own existing
// day-name literals, not a guess. Sunday is deliberately absent: no
// existing timetable data in this codebase (CSV import, manual period
// creation) ever names it as a teaching day.
const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Same UTC-based day-name resolution as attendanceService.dayOfWeekName
// (index 0 = Sunday, matching Date.getUTCDay()) — deliberately not
// duplicated as a shared util; this file has no dependency on
// attendanceService (the reverse dependency exists, not this
// direction), so the seven-name array is repeated here rather than
// introducing a new shared module for one small constant.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const studentRepository = require('../repositories/studentRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const documentService = require('./documentService');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const importService = require('./importService');
const staffService = require('./staffService');
const notificationService = require('./notificationService');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');

// resolveClassId: mirrors studentService.resolveStudentId/
// staffService.resolveStaffId — given either a real class id or a
// human-readable class_name, returns the real id, or throws
// IdentifierResolutionError if neither resolves within this college.
// Same motivation: an AI Copilot caller only has a class name to go
// on (e.g. "CSE-A"), never the internal id.
async function resolveClassId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const cls = await classRepository.findByCollegeAndClassName(client, collegeId, identifier);
  if (cls === null) {
    throw new IdentifierResolutionError(
      `no class found named ${JSON.stringify(identifier)} in this college`,
    );
  }
  return cls.id;
}

// Missing className — classes.class_name is NOT NULL at the DB level.
// Raised before any repository call, same as staffService's pre-query
// guard.
class ClassValidationError extends Error {}

// The Module 3 migration's own comment names this exact gap:
// timetable_status has no DB-level CHECK constraint, "known real
// values, enforced at the service layer once AcademicService exists,
// not the DB" — this is that enforcement. The literal set matches what
// HodDashboard.jsx/PrincipalDashboard.jsx/TutorClass.jsx actually use,
// not a guess.
class ClassTimetableStatusError extends Error {}

// UNIQUE (college_id, class_name) violated (Postgres 23505,
// classes_college_id_class_name_key) — this class name is already
// taken in this college. Never let the raw pg error reach the caller,
// same discipline as StaffCodeConflictError.
class ClassNameConflictError extends Error {}

// UNIQUE (tutor_user_id) violated (Postgres 23505,
// classes_tutor_user_id_key) — this user is already the tutor of
// another class. BusinessRules.md Staff: "Class Tutor is assigned only
// by HOD, for one class at a time" — this is that rule's DB-level
// enforcement surfacing as a domain error instead of a raw pg one.
class ClassTutorConflictError extends Error {}

// classes_tutor_user_id_fkey (classes.tutor_user_id -> users.id)
// violated (Postgres 23503) — the given tutorUserId doesn't exist in
// users. Follows StaffUserNotFoundError's precedent: tutor_user_id is
// the only FK a caller could violate via createClass/updateClass's
// inputs (college_id comes from the tenant-scoped request context, not
// caller-supplied free text), so any 23503 here unambiguously means
// this.
class ClassTutorNotFoundError extends Error {}

// classes_department_id_fkey (classes.department_id -> departments.id)
// violated (Postgres 23503) — the given departmentId doesn't exist.
// Same precedent as ClassTutorNotFoundError.
class ClassDepartmentNotFoundError extends Error {}

// Module 3->4 gap fix: 'Pending HOD'/'Pending Principal'/'Approved'/
// 'Rejected' are workflow-governed states now — reachable only via
// submitTimetableForApproval/approveTimetableApproval/
// rejectTimetableApproval, never a direct updateClass PATCH. That
// direct path was the exact "raw UPDATE... to reach the 'Approved'
// branch at all" workaround attendanceService.js's own comments (and
// tests/attendance.test.js's admin-pool seeding) already named as the
// only way to unlock attendance marking today. 'No Tutor' is the one
// literal still directly settable — it is not a step in the approval
// chain, just the "nothing submitted yet" default.
class ClassTimetableStatusManagedByWorkflowError extends Error {}

// submitTimetableForApproval/approveTimetableApproval/
// rejectTimetableApproval given a classId with no live Pending
// 'timetable_approval' workflow_requests row (never submitted, or
// already resolved) — same "required lookup, not an optional fetch"
// shape as staffService.StaffRegistrationNotPendingError.
class ClassTimetableApprovalNotPendingError extends Error {}

// Missing classId, timetablePeriodId, assignmentDate, or
// substituteStaffUserId — the columns BusinessRules.md's Substitute
// teacher provision names as always required (period, substitute,
// date), regardless of what the DB itself would accept as NULL.
class SubstituteAssignmentValidationError extends Error {}

// substitute_assignments_timetable_period_id_fkey (Postgres 23503) —
// the given timetablePeriodId doesn't exist.
class SubstituteAssignmentPeriodNotFoundError extends Error {}

// substitute_assignments_class_period_date_key violated (Postgres
// 23505) — this exact (class, period, date) slot already has a
// substitute assigned.
class SubstituteAssignmentConflictError extends Error {}

// Missing classId or a non-empty requirements array, or a requirement
// missing subject/staffUserId/periodsPerWeek — generateTimetable's own
// required inputs (BusinessRules.md Automatic timetable generation:
// "after faculty members are assigned to subjects" — this function's
// requirements array IS that assignment, supplied by the caller; there
// is no separate "subject roster" table in this schema to derive it
// from automatically, a real, flagged gap, not silently worked around).
class TimetableGenerationValidationError extends Error {}

// generateTimetable called on a class whose timetable_status is
// already 'Approved' — BusinessRules.md Timetable revision: "an
// approved timetable is immutable." Regenerating on top of an approved
// timetable would be exactly the kind of unlogged, unversioned change
// that rule exists to prevent; a permanent change belongs in a new
// revision via the ordinary submit/approve chain, not a silent
// re-generation.
class TimetableGenerationClassApprovedError extends Error {}

// Missing classId, periodId, subject, or staffUserId —
// faculty_allocation.class_id/period_id/subject are NOT NULL at the
// DB level; staffUserId is nullable at the DB level (a non-teaching
// slot like "Lunch"/"Library" can have a subject with no staff), but
// this function is specifically "assign *a staff member's*
// allocation" (per this slice's own task) — recording a non-teaching
// slot with no staff is a different, unaddressed operation, not built
// here, so staffUserId is required at this layer even though the DB
// itself would accept NULL.
class FacultyAllocationValidationError extends Error {}

// faculty_allocation_class_id_fkey violated (Postgres 23503) — the
// given classId doesn't exist. Same precedent as ClassTutorNotFoundError.
class FacultyAllocationClassNotFoundError extends Error {}

// faculty_allocation_period_id_fkey violated (Postgres 23503) — the
// given periodId doesn't exist in timetable_periods.
class FacultyAllocationPeriodNotFoundError extends Error {}

// faculty_allocation_staff_user_id_fkey violated (Postgres 23503) —
// the given staffUserId doesn't exist in users.
class FacultyAllocationStaffNotFoundError extends Error {}

// UNIQUE (class_id, period_id) violated (Postgres 23505,
// faculty_allocation_class_id_period_id_key) — this class already has
// a subject/staff assignment for this period. A class can't have two
// simultaneous subjects in one hour, the same real-world fact the
// free-text timetable grid already enforced implicitly (one cell, one
// value) — see the migration's own .ai/TASK.md.
class FacultyAllocationPeriodTakenError extends Error {}

// UNIQUE (period_id, staff_user_id) violated (Postgres 23505,
// faculty_allocation_period_id_staff_user_id_key) — this staff member
// is already teaching a different class during this exact period. The
// same "one row can't represent two conflicting real-world facts"
// reasoning ClassTutorConflictError already applies to tutor
// assignment, extended here to double-booking a teacher.
class FacultyAllocationStaffConflictError extends Error {}

// Missing dayOfWeek, hourIndex, startTime, or endTime —
// timetable_periods' own NOT NULL columns. Raised before any
// repository call, same as every other pre-query guard in this file.
class TimetablePeriodValidationError extends Error {}

// UNIQUE (college_id, day_of_week, hour_index) violated (Postgres
// 23505, timetable_periods_college_id_day_of_week_hour_index_key) —
// this college already has a period defined for this exact
// day+hour slot.
class TimetablePeriodSlotTakenError extends Error {}

// faculty_allocation_period_id_fkey violated (Postgres 23503) on a
// DELETE against timetable_periods — this period still has one or
// more faculty_allocation rows referencing it. The FK has no ON
// DELETE override (house convention, see the migration's own
// .ai/TASK.md), so Postgres's default RESTRICT raises this rather
// than silently cascading — surfaced as a domain error instead of a
// raw pg one, same discipline as every other constraint in this file.
class TimetablePeriodInUseError extends Error {}
class TimetableImportError extends Error {}

// sendClassAlert given a classId with no matching row, or an empty
// body — same "guard before any work" reasoning every other
// pre-repository-call check in this file uses.
class ClassSendAlertValidationError extends Error {}

// sendClassAlert called by a user who is not this class's own
// tutor_user_id. A distinct error (not ClassValidationError) because
// it's a 403, not a 400 — "you are not allowed" is a different kind of
// failure than "the request itself is malformed," same split
// classes.js's route layer already makes between mapAcademicServiceError's
// 400s and requirePermission's own 403s.
class ClassSendAlertNotTutorError extends Error {}

// Known real timetable_status values, per the migration's own comment
// and .ai/TASK.md's grounding against TutorClass.jsx/
// TutorClassMonitor.jsx.
const VALID_TIMETABLE_STATUSES = [
  'No Tutor',
  'Pending HOD',
  'Pending Principal',
  'Approved',
  'Rejected',
];

// The fields this service accepts for create/update, deliberately
// listed here rather than trusting classRepository's own COLUMNS
// whitelist to be the only line of defense — same defense-in-depth
// reasoning as studentService.js/staffService.js's own ALLOWED_FIELDS.
// collegeId is excluded: a class's tenant is set once at creation and
// never moves via update, same as students/staff.
const ALLOWED_FIELDS = [
  'className',
  'department',
  'departmentId',
  'semester',
  'tutorUserId',
  'timetableStatus',
  'timetableData',
  'timetableRemarks',
];

function pickClassFields(source) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function assertValidTimetableStatus(timetableStatus) {
  if (timetableStatus !== undefined && !VALID_TIMETABLE_STATUSES.includes(timetableStatus)) {
    throw new ClassTimetableStatusError(
      `timetableStatus ${JSON.stringify(timetableStatus)} is not a known value`,
    );
  }
}

async function createClass(client, { collegeId, className, ...rest }, { actorUserId } = {}) {
  if (!className) {
    throw new ClassValidationError('className is required');
  }
  assertValidTimetableStatus(rest.timetableStatus);

  let cls;
  try {
    cls = await classRepository.create(client, {
      collegeId,
      className,
      ...pickClassFields(rest),
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'classes_college_id_class_name_key') {
      throw new ClassNameConflictError(`className ${JSON.stringify(className)} already exists for this college`);
    }
    if (err.code === '23505' && err.constraint === 'classes_tutor_user_id_key') {
      throw new ClassTutorConflictError(`tutorUserId ${JSON.stringify(rest.tutorUserId)} is already tutoring another class`);
    }
    if (err.code === '23503' && err.constraint === 'classes_tutor_user_id_fkey') {
      throw new ClassTutorNotFoundError(`tutorUserId ${JSON.stringify(rest.tutorUserId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'classes_department_id_fkey') {
      throw new ClassDepartmentNotFoundError(`departmentId ${JSON.stringify(rest.departmentId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'class_created',
    entity: 'classes',
    entityId: cls.id,
    metadata: null,
  });

  return cls;
}

// null means no class exists with this id — not an error. The route
// turns that into 404, same as staffService.getStaff.
async function getClass(client, id) {
  return classRepository.findById(client, id);
}

const WORKFLOW_MANAGED_TIMETABLE_STATUSES = ['Pending HOD', 'Pending Principal', 'Approved', 'Rejected'];

async function updateClass(client, id, fields, { userId }) {
  const patch = pickClassFields(fields);
  assertValidTimetableStatus(patch.timetableStatus);
  if (WORKFLOW_MANAGED_TIMETABLE_STATUSES.includes(patch.timetableStatus)) {
    throw new ClassTimetableStatusManagedByWorkflowError(
      `timetableStatus ${JSON.stringify(patch.timetableStatus)} can only be reached via submitTimetableForApproval/approveTimetableApproval/rejectTimetableApproval, not a direct update`,
    );
  }
  const hasChanges = Object.keys(patch).length > 0;

  let cls;
  try {
    cls = await classRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'classes_college_id_class_name_key') {
      throw new ClassNameConflictError(`className ${JSON.stringify(patch.className)} already exists for this college`);
    }
    if (err.code === '23505' && err.constraint === 'classes_tutor_user_id_key') {
      throw new ClassTutorConflictError(`tutorUserId ${JSON.stringify(patch.tutorUserId)} is already tutoring another class`);
    }
    if (err.code === '23503' && err.constraint === 'classes_tutor_user_id_fkey') {
      throw new ClassTutorNotFoundError(`tutorUserId ${JSON.stringify(patch.tutorUserId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'classes_department_id_fkey') {
      throw new ClassDepartmentNotFoundError(`departmentId ${JSON.stringify(patch.departmentId)} does not exist`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // classRepository.update falls back to a plain findById then). cls
  // !== null guards the id-not-found case. Either way, no row was
  // actually changed, so no audit entry.
  if (hasChanges && cls !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: cls.college_id,
      userId,
      action: 'class_updated',
      entity: 'classes',
      entityId: id,
      metadata: null,
    });
  }

  return cls;
}

// Looks the class up first, both to get collegeId for the audit entry
// (removeClass's signature, matching staffService.removeStaff, takes
// no collegeId of its own) and to avoid logging a removal for an id
// that never existed. Still a hard DELETE, not a soft-delete: the ERD
// has no soft-delete column yet — same open question flagged for
// students/staff, not resolved here either.
async function removeClass(client, id, { userId }) {
  const cls = await classRepository.findById(client, id);
  if (cls === null) {
    return null;
  }

  await classRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId,
    action: 'class_removed',
    entity: 'classes',
    entityId: id,
    metadata: null,
  });

  return cls;
}

async function listClasses(client, { limit, offset } = {}) {
  return classRepository.list(client, { limit, offset });
}

// Module 3->4 gap fix: BusinessRules.md/HodDashboard.jsx/
// PrincipalDashboard.jsx's own timetable review chain ('Pending HOD'
// -> 'Approved'/'Pending Principal'/'Rejected') modeled as a 2-step
// approver_chain through the one real WorkflowService gate (CLAUDE.md
// rule 3/ADR-005), same shape as staffService.submitStaffRegistration:
// HOD (of the class's own department) then Principal, both resolved
// from real data via staffService.findHodForDepartment/findPrincipal,
// never hardcoded. No parallel approval mechanism — this is the same
// generic workflow_requests table/submitRequest every other approval
// already routes through, just a new entityType.
async function submitTimetableForApproval(client, classId, { requestedByUserId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new ClassValidationError('requestedByUserId is required');
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  if (!cls.department_id) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} has no departmentId set, cannot resolve an hod approver`);
  }

  // BusinessRules.md Configurable approval workflow: reads the
  // institution's own configured chain for 'timetable_approval'
  // (category 'workflow_chains'), falling back to the same hod->principal
  // default this codebase always used — an institution that hasn't
  // configured anything sees identical behavior to before this slice.
  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId: cls.college_id, entityType: 'timetable_approval', classId: cls.id, departmentId: cls.department_id,
  });

  const request = await workflowService.submitRequest(client, {
    collegeId: cls.college_id,
    entityType: 'timetable_approval',
    entityId: cls.id,
    requestedByUserId,
    origin,
    approverChain,
  });

  await classRepository.update(client, classId, { timetableStatus: 'Pending HOD' });

  return request;
}

// Shared load+validate for approve/reject: the class must exist, and
// exactly one live Pending 'timetable_approval' workflow_requests row
// must govern it — same shape as staffService.loadPendingRegistration.
async function loadPendingTimetableApproval(client, classId) {
  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'timetable_approval', classId);
  if (pending === null) {
    throw new ClassTimetableApprovalNotPendingError(`class ${JSON.stringify(classId)} has no pending timetable approval request`);
  }

  return pending;
}

// The actual Module 3->4 unblock: workflowService.approveRequest alone
// only ever flips workflow_requests.status — nothing else in this
// codebase mirrors that outcome onto classes.timetable_status, which
// is the one column attendanceService.assertTimetableApproved actually
// gates on. Mid-chain (the HOD's own step) advances the visible status
// to 'Pending Principal' without closing the request; the terminal
// step (status -> 'Approved') is the only point that flips
// timetable_status to 'Approved' and genuinely unblocks attendance.
async function approveTimetableApproval(client, classId, { actorUserId, remarks, effectiveFrom } = {}) {
  const pending = await loadPendingTimetableApproval(client, classId);
  const resolved = await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const nextStatus = resolved.status === 'Approved' ? 'Approved' : 'Pending Principal';
  const cls = await classRepository.update(client, classId, { timetableStatus: nextStatus });

  // BusinessRules.md Timetable revision: "any permanent academic
  // change is recorded as a new, numbered, dated revision." The
  // terminal step of the chain (status flips to 'Approved') is the one
  // point a class's timetable actually becomes the new authoritative
  // version — same "only the terminal step genuinely unblocks
  // attendance" reasoning this function's own existing comment already
  // gives for timetable_status, extended here to revisions. Additive
  // only: attendanceService's own gate is untouched by this (see the
  // migration's file-level comment) — this purely builds the
  // permanently-retained history the rule requires.
  let revision = null;
  if (nextStatus === 'Approved') {
    const revisionNumber = (await timetableRevisionRepository.countForClass(client, classId)) + 1;
    revision = await timetableRevisionRepository.create(client, {
      collegeId: cls.college_id,
      classId,
      revisionNumber,
      effectiveFrom: effectiveFrom || new Date().toISOString().slice(0, 10),
      workflowRequestId: pending.id,
      createdByUserId: actorUserId,
    });
  }

  return { workflowRequest: resolved, class: cls, revision };
}

// BusinessRules.md: "attendance always uses the timetable revision
// effective on the class date." Exposed as a read-only lookup other
// services (or a future attendanceService rewiring) can consult;
// see timetable_revisions migration's own comment on why
// attendanceService's existing gate doesn't call this yet.
async function getEffectiveTimetableRevision(client, classId, date) {
  return timetableRevisionRepository.findEffectiveForDate(client, classId, date);
}

async function listTimetableRevisions(client, classId) {
  return timetableRevisionRepository.listForClass(client, classId);
}

// BusinessRules.md Substitute teacher provision: "an authorized
// academic authority may temporarily assign another qualified faculty
// member to conduct the scheduled class... does not change the
// official timetable." Authorization ("authorized academic authority" —
// HOD or equivalent) is left to the route/RBAC layer, same "role check
// at the route, not invented here" split every other action in this
// file without a schema-resolvable actor uses; assigningAuthorityUserId
// is recorded as a plain audit fact regardless of who the route let
// through.
async function assignSubstitute(client, {
  classId, timetablePeriodId, assignmentDate, originalStaffUserId, substituteStaffUserId, reason,
}, { actorUserId } = {}) {
  if (!classId || !timetablePeriodId || !assignmentDate || !substituteStaffUserId) {
    throw new SubstituteAssignmentValidationError(
      'classId, timetablePeriodId, assignmentDate, and substituteStaffUserId are required',
    );
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }

  let assignment;
  try {
    assignment = await substituteAssignmentRepository.create(client, {
      collegeId: cls.college_id,
      classId,
      timetablePeriodId,
      assignmentDate,
      originalStaffUserId,
      substituteStaffUserId,
      assigningAuthorityUserId: actorUserId,
      reason,
    });
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'substitute_assignments_timetable_period_id_fkey') {
      throw new SubstituteAssignmentPeriodNotFoundError(`timetable period ${JSON.stringify(timetablePeriodId)} does not exist`);
    }
    if (err.code === '23505' && err.constraint === 'substitute_assignments_class_period_date_key') {
      throw new SubstituteAssignmentConflictError(
        `class ${JSON.stringify(classId)}, period ${JSON.stringify(timetablePeriodId)} already has a substitute assigned for ${JSON.stringify(assignmentDate)}`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'substitute_assigned',
    entity: 'substitute_assignments',
    entityId: assignment.id,
    metadata: null,
  });

  return assignment;
}

// The one lookup attendanceService's own assertCanMark composes,
// mirroring getFacultyAllocationForClassAndPeriod's own "thin
// passthrough AttendanceService reads timetable/approval-adjacent
// state through" precedent — AttendanceService never queries
// substitute_assignments directly (Architecture.md 2.5: AttendanceService
// reads, does not own, timetable state from AcademicService). classId
// is required (not just periodId): timetable_periods is the shared
// college-wide bell schedule, reused by many different classes for the
// same (day, hour) — see substituteAssignmentRepository's own comment.
async function getSubstituteAssignment(client, classId, timetablePeriodId, assignmentDate) {
  return substituteAssignmentRepository.findByClassPeriodAndDate(client, classId, timetablePeriodId, assignmentDate);
}

async function listSubstituteAssignmentsForClass(client, classId) {
  return substituteAssignmentRepository.listForClass(client, classId);
}

// BusinessRules.md Automatic timetable generation: "after faculty
// members are assigned to subjects, the system shall automatically
// generate a balanced, conflict-free timetable for a department/class
// ... AI shall prevent faculty, classroom, and laboratory conflicts by
// respecting existing approved timetable allocations across the
// institution ... if no conflict-free timetable can be generated, AI
// reports the conflict for HOD action."
//
// requirements: [{ subject, staffUserId, periodsPerWeek }] — this
// function's own required input, not derived from a "subject roster"
// table (none exists in this schema; see
// TimetableGenerationValidationError's own comment). One class at a
// time (never institution-wide in one call), matching the rule's own
// "class/department" scope wording.
//
// Conflict prevention is the real UNIQUE (period_id, staff_user_id)
// constraint on faculty_allocation (Module 3 timetable-normalization
// migration) doing the actual work — a staff member already allocated
// to ANY class during a given period cannot be allocated to a second
// one, enforced by Postgres itself, not re-implemented as an
// application-level check here. This function's own job is choosing
// candidate (day, hour) slots in a sensible order and falling back to
// the next one when the DB rejects a candidate, not deciding "is this
// staff member free" itself.
async function generateTimetable(client, classId, requirements, { actorUserId } = {}) {
  if (!classId || !Array.isArray(requirements) || requirements.length === 0) {
    throw new TimetableGenerationValidationError('classId and a non-empty requirements array are required');
  }
  for (const req of requirements) {
    if (!req.subject || !req.staffUserId || !req.periodsPerWeek || req.periodsPerWeek < 1) {
      throw new TimetableGenerationValidationError(
        'each requirement needs subject, staffUserId, and a periodsPerWeek of at least 1',
      );
    }
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  if (cls.timetable_status === 'Approved') {
    throw new TimetableGenerationClassApprovedError(
      `class ${JSON.stringify(classId)}'s timetable is already Approved — submit a permanent change through the revision workflow instead of regenerating`,
    );
  }

  const allPeriods = await timetablePeriodRepository.findAllByCollege(client, cls.college_id);
  const sortedPeriods = [...allPeriods].sort((a, b) => {
    const dayDiff = WEEKDAY_ORDER.indexOf(a.day_of_week) - WEEKDAY_ORDER.indexOf(b.day_of_week);
    return dayDiff !== 0 ? dayDiff : a.hour_index - b.hour_index;
  });

  const existingForClass = await facultyAllocationRepository.findByClassId(client, classId);
  const usedPeriodIds = new Set(existingForClass.map((row) => row.period_id));

  const placements = [];
  const conflicts = [];

  for (const req of requirements) {
    let placedCount = 0;
    for (const period of sortedPeriods) {
      if (placedCount >= req.periodsPerWeek) break;
      if (usedPeriodIds.has(period.id)) continue;

      try {
        // eslint-disable-next-line no-await-in-loop
        const allocation = await facultyAllocationRepository.create(client, {
          collegeId: cls.college_id,
          classId,
          periodId: period.id,
          subject: req.subject,
          staffUserId: req.staffUserId,
        });
        usedPeriodIds.add(period.id);
        placements.push(allocation);
        placedCount += 1;
      } catch (err) {
        // faculty_allocation's own UNIQUE (period_id, staff_user_id) —
        // this staff member is already teaching another class during
        // this exact period; try the next candidate period instead of
        // aborting the whole generation.
        if (err.code === '23505') {
          usedPeriodIds.add(period.id);
          continue; // eslint-disable-line no-continue
        }
        throw err;
      }
    }
    if (placedCount < req.periodsPerWeek) {
      conflicts.push({
        subject: req.subject,
        staffUserId: req.staffUserId,
        requested: req.periodsPerWeek,
        placed: placedCount,
        reason: 'not enough conflict-free periods available',
      });
    }
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'timetable_generated',
    entity: 'classes',
    entityId: classId,
    metadata: { placedCount: placements.length, conflictCount: conflicts.length },
  });

  return { placements, conflicts };
}

// BusinessRules.md AI Attendance Management: "AI identifies the
// current class from the approved timetable [and] confirms the
// faculty is assigned to that session or is the authorized
// substitute." Resolves, for a given staff member right now (or at a
// caller-supplied instant, for testability), which class's period they
// are scheduled to teach — checking their own faculty_allocation rows
// first, then falling back to a substitute_assignments row naming them
// for that exact (class, period, date). Returns null if no such
// session exists (outside teaching hours, or scheduled for nothing
// this period) — the caller (attendanceService's AI assistant) turns
// that into "you have no active session right now," not a guess.
//
// UTC-based day/time extraction, same tradeoff attendanceService.
// dayOfWeekName documents for its own date-only parsing: avoids a
// server-local-timezone rollover bug, at the cost of not matching a
// user's own wall-clock day exactly at midnight boundaries in other
// timezones — an accepted, documented tradeoff, not an oversight.
async function resolveCurrentSessionForStaff(client, collegeId, staffUserId, { now } = {}) {
  const instant = now || new Date();
  const dayName = DAY_NAMES[instant.getUTCDay()];
  const currentTime = instant.toISOString().slice(11, 19);
  const sessionDate = instant.toISOString().slice(0, 10);

  const period = await timetablePeriodRepository.findCurrentByCollegeAndDay(client, collegeId, dayName, currentTime);
  if (period === null) {
    return null;
  }

  const ownAllocations = await facultyAllocationRepository.findByStaffUserId(client, staffUserId);
  const ownAllocation = ownAllocations.find((a) => a.period_id === period.id);
  if (ownAllocation !== null && ownAllocation !== undefined) {
    return {
      classId: ownAllocation.class_id, periodId: period.id, hourIndex: period.hour_index, sessionDate,
    };
  }

  // No own allocation for this period — check every class's
  // substitute_assignments row for this exact (period, date) rather
  // than one specific class, since resolveCurrentSessionForStaff
  // doesn't know the class yet (that's what it's resolving); a college
  // running many classes in the same period could have several
  // substitute rows for that (period, date), one per class, so this
  // has to search across classes, not call
  // getSubstituteAssignment(classId, ...) the way assertCanMark does
  // once it already has a specific class in hand.
  const substitution = await substituteAssignmentRepository.findByStaffPeriodAndDate(client, staffUserId, period.id, sessionDate);
  if (substitution !== null) {
    return {
      classId: substitution.class_id, periodId: period.id, hourIndex: period.hour_index, sessionDate,
    };
  }

  return null;
}

// Rejecting at any step ends the whole chain (workflowService's own
// rule) — mirrored onto timetable_status -> 'Rejected', matching the
// known literal HodDashboard.jsx/PrincipalDashboard.jsx already use
// for this outcome. A rejected class must go through
// submitTimetableForApproval again to re-enter the chain, same
// "resubmit as a new request" precedent workflowService.js's own
// file-level comment already documents.
async function rejectTimetableApproval(client, classId, { actorUserId, remarks } = {}) {
  const pending = await loadPendingTimetableApproval(client, classId);
  const resolved = await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });
  const cls = await classRepository.update(client, classId, { timetableStatus: 'Rejected' });

  return { workflowRequest: resolved, class: cls };
}

// Assigns a staff member to teach a subject during a specific
// (class, period) slot. No update variant is exposed here — this
// slice's own task names exactly "assign/list/remove," not "update";
// changing an existing allocation is remove-then-assign, not an
// in-place edit, even though facultyAllocationRepository.update exists
// and classRepository's own precedent has a full update path. Nothing
// asked for reassignment-in-place, so it isn't built.
async function assignFacultyAllocation(client, { collegeId, classId, periodId, subject, staffUserId }, { actorUserId } = {}) {
  if (!classId || !periodId || !subject || !staffUserId) {
    throw new FacultyAllocationValidationError('classId, periodId, subject, and staffUserId are required');
  }

  let allocation;
  try {
    allocation = await facultyAllocationRepository.create(client, {
      collegeId,
      classId,
      periodId,
      subject,
      staffUserId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'faculty_allocation_class_id_period_id_key') {
      throw new FacultyAllocationPeriodTakenError(
        `class ${JSON.stringify(classId)} already has an allocation for period ${JSON.stringify(periodId)}`,
      );
    }
    if (err.code === '23505' && err.constraint === 'faculty_allocation_period_id_staff_user_id_key') {
      throw new FacultyAllocationStaffConflictError(
        `staffUserId ${JSON.stringify(staffUserId)} is already teaching another class during period ${JSON.stringify(periodId)}`,
      );
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_class_id_fkey') {
      throw new FacultyAllocationClassNotFoundError(`classId ${JSON.stringify(classId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_period_id_fkey') {
      throw new FacultyAllocationPeriodNotFoundError(`periodId ${JSON.stringify(periodId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'faculty_allocation_staff_user_id_fkey') {
      throw new FacultyAllocationStaffNotFoundError(`staffUserId ${JSON.stringify(staffUserId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'faculty_allocation_assigned',
    entity: 'faculty_allocation',
    entityId: allocation.id,
    metadata: null,
  });

  return allocation;
}

// null means no allocation exists with this id — not an error. The
// route turns that into 404, same as getClass.
async function getFacultyAllocation(client, id) {
  return facultyAllocationRepository.findById(client, id);
}

// A class's full teaching schedule — every period it has a real
// subject/staff assignment for.
async function listFacultyAllocationsForClass(client, classId) {
  return facultyAllocationRepository.findByClassId(client, classId);
}

// A staff member's full teaching schedule — the real, structured link
// AttendanceService's own "scheduled staff member" gap needed (see
// attendanceService.js, 82f8479 for where it was flagged, and its
// later patch for where it's actually wired in).
async function listFacultyAllocationsForStaff(client, staffUserId) {
  return facultyAllocationRepository.findByStaffUserId(client, staffUserId);
}

// null means no shared period exists for that (college, day, hour) —
// not an error, same convention as every other getX in this file.
// This is the lookup attendanceService.markAttendance uses to resolve
// a calendar date + hour_index into the shared timetable_periods row
// before it can ask "who's allocated to teach this class then." Named
// ...ByDayAndHour, not the bare getTimetablePeriod(id) shape every
// other getX in this file uses, specifically to leave that simpler
// name free for the plain by-id lookup below — this one takes three
// arguments and answers a different question ("does a period exist
// for this slot") than "fetch this known period."
async function getTimetablePeriodByDayAndHour(client, collegeId, dayOfWeek, hourIndex) {
  return timetablePeriodRepository.findByCollegeDayAndHour(client, collegeId, dayOfWeek, hourIndex);
}

// null means no allocation exists for that (class, period) — not an
// error. The other half of the same lookup: once a period is
// resolved, this answers "which staff member (if any) is allocated to
// teach this specific class during it."
async function getFacultyAllocationForClassAndPeriod(client, classId, periodId) {
  return facultyAllocationRepository.findByClassAndPeriod(client, classId, periodId);
}

// Defines one shared, college-wide bell-schedule slot. No
// authorization check: same reasoning as assignFacultyAllocation —
// BusinessRules.md names no specific actor for "who may define
// periods," left to the route/RBAC layer once an API exists.
async function createTimetablePeriod(client, { collegeId, dayOfWeek, hourIndex, startTime, endTime }, { actorUserId } = {}) {
  if (!dayOfWeek || hourIndex === undefined || hourIndex === null || !startTime || !endTime) {
    throw new TimetablePeriodValidationError('dayOfWeek, hourIndex, startTime, and endTime are required');
  }

  let period;
  try {
    period = await timetablePeriodRepository.create(client, {
      collegeId,
      dayOfWeek,
      hourIndex,
      startTime,
      endTime,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'timetable_periods_college_id_day_of_week_hour_index_key') {
      throw new TimetablePeriodSlotTakenError(
        `a period already exists for ${JSON.stringify(dayOfWeek)} hour ${JSON.stringify(hourIndex)} in this college`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'timetable_period_created',
    entity: 'timetable_periods',
    entityId: period.id,
    metadata: null,
  });

  return period;
}

// BusinessRules.md Central audit log and Import/Export: parsing is now
// importService's job (task #18's own shared platform service,
// retrofitted here as its proof) \u2014 this function keeps only what's
// genuinely timetable-specific: which columns are required, the
// optional-allocation-columns rule, and the per-row commit/savepoint
// logic below, unchanged.
async function importTimetablePeriodsCsv(client, { collegeId, fileName = 'timetable.csv', fileBuffer }, { actorUserId } = {}) {
  if (!fileBuffer || !actorUserId) {
    throw new TimetableImportError('fileBuffer and actorUserId are required');
  }

  const rawDocument = await documentService.uploadDocument(
    client,
    { collegeId, docType: 'timetable_import', fileName, mimeType: 'text/csv', fileBuffer },
    { actorUserId },
  );

  const { headers, rows } = await importService.parseImportFile(fileBuffer, 'text/csv');
  if (rows.length === 0) {
    throw new TimetableImportError('csv must include a header and at least one row');
  }
  const required = ['day_of_week', 'hour_index', 'start_time', 'end_time'];
  for (const name of required) {
    if (!headers.includes(name)) throw new TimetableImportError(`csv missing ${name}`);
  }
  // class_id/subject/staff_user_id are optional: a plain bell-schedule
  // CSV (just the 4 required columns) still imports periods only, same
  // as before. Only rows that carry all three also get a
  // faculty_allocation row and a classes.timetable_data entry.
  const hasAllocationColumns = ['class_id', 'subject', 'staff_user_id'].every((name) => headers.includes(name));

  const imported = [];
  const skipped = [];
  const timetableDataByClassId = new Map();
  let rowNumber = 0;
  for (const row of rows) {
    rowNumber += 1;
    // Each row gets its own SAVEPOINT: a UNIQUE violation (23505)
    // otherwise poisons the whole surrounding transaction in Postgres
    // (every later statement fails with "current transaction is
    // aborted" regardless of its own validity), turning one duplicate
    // row into an all-or-nothing 500. ROLLBACK TO SAVEPOINT undoes
    // just this row's failed INSERT and clears the aborted state,
    // letting the loop continue.
    const savepoint = `csv_import_row_${rowNumber}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.query(`SAVEPOINT ${savepoint}`);
      // eslint-disable-next-line no-await-in-loop
      const period = await createTimetablePeriod(client, {
        collegeId,
        dayOfWeek: row.day_of_week,
        hourIndex: Number(row.hour_index),
        startTime: row.start_time,
        endTime: row.end_time,
      }, { actorUserId });
      if (hasAllocationColumns && row.class_id && row.subject && row.staff_user_id) {
        // eslint-disable-next-line no-await-in-loop
        await assignFacultyAllocation(client, {
          collegeId,
          classId: row.class_id,
          periodId: period.id,
          subject: row.subject,
          staffUserId: row.staff_user_id,
        }, { actorUserId });
        if (!timetableDataByClassId.has(row.class_id)) timetableDataByClassId.set(row.class_id, []);
        timetableDataByClassId.get(row.class_id).push({
          periodId: period.id,
          dayOfWeek: row.day_of_week,
          hourIndex: Number(row.hour_index),
          startTime: row.start_time,
          endTime: row.end_time,
          subject: row.subject,
          staffUserId: row.staff_user_id,
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      imported.push({ row: rowNumber, dayOfWeek: row.day_of_week, hourIndex: Number(row.hour_index) });
    } catch (err) {
      if (
        err instanceof TimetablePeriodSlotTakenError
        || err instanceof FacultyAllocationPeriodTakenError
        || err instanceof FacultyAllocationStaffConflictError
      ) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        skipped.push({ row: rowNumber, reason: err.message });
      } else {
        throw err;
      }
    }
  }

  // Merge, don't overwrite: a class's timetable_data may already carry
  // entries from a prior import or manual update.
  for (const [classId, entries] of timetableDataByClassId.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const cls = await classRepository.findById(client, classId);
    if (cls === null) continue;
    const existing = Array.isArray(cls.timetable_data) ? cls.timetable_data : [];
    // node-pg serializes a raw JS array parameter as a Postgres ARRAY
    // literal, not JSON text — invalid for a jsonb column. Must be
    // JSON.stringify'd first, same driver quirk workflowRepository.js's
    // own toRow() already works around for approverChain/actionManifest.
    // eslint-disable-next-line no-await-in-loop
    await classRepository.update(client, classId, { timetableData: JSON.stringify([...existing, ...entries]) });
  }

  return { rawDocumentId: rawDocument.id, imported, skipped, totalRows: rows.length };
}

// null means no period exists with this id — not an error. The route
// turns that into 404, same as getClass/getFacultyAllocation.
async function getTimetablePeriod(client, id) {
  return timetablePeriodRepository.findById(client, id);
}

async function listTimetablePeriods(client, { limit, offset } = {}) {
  return timetablePeriodRepository.list(client, { limit, offset });
}

// Looks the period up first, both to get collegeId for the audit
// entry and to avoid logging a removal for an id that never existed —
// same shape as removeClass/removeFacultyAllocation. Maps the FK
// RESTRICT case (a faculty_allocation row still references this
// period) to a real domain error instead of a raw pg one; every other
// removeX in this file hard-deletes without needing this because
// nothing else FKs into classes/faculty_allocation/students/staff the
// way faculty_allocation FKs into timetable_periods.
async function removeTimetablePeriod(client, id, { actorUserId } = {}) {
  const period = await timetablePeriodRepository.findById(client, id);
  if (period === null) {
    return null;
  }

  try {
    await timetablePeriodRepository.remove(client, id);
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'faculty_allocation_period_id_fkey') {
      throw new TimetablePeriodInUseError(
        `period ${JSON.stringify(id)} still has faculty_allocation rows referencing it`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: period.college_id,
    userId: actorUserId,
    action: 'timetable_period_removed',
    entity: 'timetable_periods',
    entityId: id,
    metadata: null,
  });

  return period;
}

// Looks the allocation up first, both to get collegeId for the audit
// entry (this function takes no collegeId of its own, matching
// removeClass's signature) and to avoid logging a removal for an id
// that never existed. Hard DELETE, not soft-delete: neither
// faculty_allocation nor timetable_periods is named by
// BusinessRules.md's AI hard-delete restriction the way
// attendance_sessions is — same open-question treatment
// students/staff/classes already got.
async function removeFacultyAllocation(client, id, { actorUserId } = {}) {
  const allocation = await facultyAllocationRepository.findById(client, id);
  if (allocation === null) {
    return null;
  }

  await facultyAllocationRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: allocation.college_id,
    userId: actorUserId,
    action: 'faculty_allocation_removed',
    entity: 'faculty_allocation',
    entityId: id,
    metadata: null,
  });

  return allocation;
}

// Send Alert (item 5 of this session's task): a tutor sending a plain-
// text WhatsApp message to every student in their OWN class, plus
// whichever of that student's/their parent's numbers are WhatsApp-
// verified (phone_verified/parent_phone_verified — see
// phoneVerificationService.js). Deliberately NOT routed through
// WorkflowService — this is the one explicitly documented exception to
// "every outbound notification requires approval" (BusinessRules.md's
// Notifications section, AI-Governance.md's L3 "Act" table): a human
// tutor directly messaging students already enrolled in their own
// class, with plain free-text content and no AI involvement, is
// structurally the same kind of action AI-Governance.md already
// carves out for a staff member marking attendance directly through
// the dashboard — not an AI action, so L3's "always required, no
// exceptions" language never applies to it in the first place. Scoped
// tightly on purpose (own class only, human-sent only, plain text
// only): any future variant (AI-drafted content, cross-class blasts,
// rich content) is a different feature that DOES need
// draftNotification/submitForApproval, not an extension of this one.
//
// Per-recipient, best-effort, no retry/fallback (this session's own
// task: "no auto-retry or channel fallback") — matches
// notificationService.sendViaChannel's own best-effort philosophy for
// every other channel in this codebase. A student with neither number
// verified is simply absent from the result list, not a failure.
async function sendClassAlert(client, classId, body, { actorUserId } = {}) {
  if (!body) {
    throw new ClassSendAlertValidationError('body is required');
  }

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassSendAlertValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  if (cls.tutor_user_id !== actorUserId) {
    throw new ClassSendAlertNotTutorError(`user ${JSON.stringify(actorUserId)} is not the tutor of class ${JSON.stringify(classId)}`);
  }

  const students = await studentRepository.findByClassId(client, classId);

  const results = [];
  for (const student of students) {
    const recipients = [
      { target: 'phone', verified: student.phone_verified, phone: student.phone },
      { target: 'parent_phone', verified: student.parent_phone_verified, phone: student.parent_phone },
    ].filter((r) => r.verified && r.phone);

    for (const recipient of recipients) {
      // eslint-disable-next-line no-await-in-loop
      const sendResult = await notificationService.sendViaChannel(client, {
        collegeId: cls.college_id,
        channel: 'whatsapp',
        to: recipient.phone,
        body,
      });
      results.push({
        studentId: student.id,
        target: recipient.target,
        phone: recipient.phone,
        status: sendResult.status,
        error: sendResult.error || null,
      });
    }
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'class_alert_sent',
    entity: 'classes',
    entityId: classId,
    metadata: {
      recipientCount: results.length,
      sentCount: results.filter((r) => r.status === 'sent').length,
    },
  });

  return results;
}

// Same pragmatic hardcoded-limit convention reportService.js's own
// STUDENT_EXPORT_LIMIT already uses — a college with more classes than
// this gets a truncated college-wide timetable read, a flagged gap,
// not silently wrong data.
const CLASS_TIMETABLE_SCOPE_LIMIT = 500;

// academic_class_timetable (AI tool): scope-aware "my classes'
// timetable" read. Resolves the actor's own visible classIds via
// visibilityService.getVisibleClassIds — the one shared resolver
// analyticsService.getAttendanceRateForActor/assessmentService.
// listMarksForActor already use identically — never a caller-supplied
// classId/departmentId. null from getVisibleClassIds means
// "unrestricted" (principal), so every class in the college is
// enumerated via listClasses rather than treated as an empty filter.
async function getClassTimetableForActor(client, { actorUserId, actorRole, collegeId }) {
  const classIds = await visibilityService.getVisibleClassIds(client, { actorUserId, actorRole, collegeId });

  let targetClassIds;
  if (classIds === null) {
    const classes = await listClasses(client, { limit: CLASS_TIMETABLE_SCOPE_LIMIT });
    targetClassIds = classes.map((cls) => cls.id);
  } else {
    targetClassIds = classIds;
  }
  if (targetClassIds.length === 0) {
    return [];
  }

  return Promise.all(targetClassIds.map(async (classId) => {
    const cls = await classRepository.findById(client, classId);
    const allocations = await listFacultyAllocationsForClass(client, classId);
    return { classId, className: cls ? cls.class_name : null, allocations };
  }));
}

module.exports = {
  ClassValidationError,
  ClassTimetableStatusError,
  ClassNameConflictError,
  ClassTutorConflictError,
  ClassTutorNotFoundError,
  ClassDepartmentNotFoundError,
  ClassTimetableStatusManagedByWorkflowError,
  ClassTimetableApprovalNotPendingError,
  SubstituteAssignmentValidationError,
  SubstituteAssignmentPeriodNotFoundError,
  SubstituteAssignmentConflictError,
  TimetableGenerationValidationError,
  TimetableGenerationClassApprovedError,
  FacultyAllocationValidationError,
  FacultyAllocationClassNotFoundError,
  FacultyAllocationPeriodNotFoundError,
  FacultyAllocationStaffNotFoundError,
  FacultyAllocationPeriodTakenError,
  FacultyAllocationStaffConflictError,
  TimetablePeriodValidationError,
  TimetablePeriodSlotTakenError,
  TimetablePeriodInUseError,
  TimetableImportError,
  ClassSendAlertValidationError,
  ClassSendAlertNotTutorError,
  sendClassAlert,
  createClass,
  getClass,
  resolveClassId,
  updateClass,
  removeClass,
  listClasses,
  submitTimetableForApproval,
  approveTimetableApproval,
  rejectTimetableApproval,
  getEffectiveTimetableRevision,
  listTimetableRevisions,
  assignSubstitute,
  getSubstituteAssignment,
  listSubstituteAssignmentsForClass,
  generateTimetable,
  resolveCurrentSessionForStaff,
  assignFacultyAllocation,
  getFacultyAllocation,
  listFacultyAllocationsForClass,
  listFacultyAllocationsForStaff,
  removeFacultyAllocation,
  getTimetablePeriodByDayAndHour,
  getFacultyAllocationForClassAndPeriod,
  createTimetablePeriod,
  importTimetablePeriodsCsv,
  getTimetablePeriod,
  listTimetablePeriods,
  removeTimetablePeriod,
  getClassTimetableForActor,
};
