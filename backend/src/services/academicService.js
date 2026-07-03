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

const classRepository = require('../repositories/classRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

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

async function updateClass(client, id, fields, { userId }) {
  const patch = pickClassFields(fields);
  assertValidTimetableStatus(patch.timetableStatus);
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

module.exports = {
  ClassValidationError,
  ClassTimetableStatusError,
  ClassNameConflictError,
  ClassTutorConflictError,
  ClassTutorNotFoundError,
  createClass,
  getClass,
  updateClass,
  removeClass,
  listClasses,
};
