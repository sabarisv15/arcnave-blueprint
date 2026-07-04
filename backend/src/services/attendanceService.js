'use strict';

// Business logic for Module 4's `attendance_sessions` table —
// validation, authorization, and audit logging on top of
// attendanceRepository.js, which does neither (CLAUDE.md rule 1: AI
// tools call Business Services, never repositories directly — this
// file is what makes that possible for attendance).
//
// Reads timetable/approval state through academicService.getClass,
// never classRepository directly: Architecture.md 2.5 states this in
// so many words — "AttendanceService ... reads (does not own)
// timetable/approval state from AcademicService." This is the first
// cross-domain service composition in this codebase (every prior
// service call its own single repository); CLAUDE.md rule 4
// ("repositories never call other repositories") doesn't apply here —
// this is service-to-service, not repository-to-repository.
//
// Two rules from BusinessRules.md's Attendance section are enforced
// here for real, and one is deliberately not — see the two comments
// below (assertTimetableApproved, assertCanMark) for exactly which
// and why. Neither is worked around or faked.

const attendanceRepository = require('../repositories/attendanceRepository');
const academicService = require('./academicService');
const auditLogRepository = require('../repositories/auditLogRepository');

// Missing classId/sessionDate/hourIndex/totalStudents, or missing
// actor identity (actorUserId/actorRole). Unlike e.g.
// academicService.createClass's optional actorUserId (which only
// affects audit attribution there), actor identity is required here:
// markAttendance cannot evaluate the authorization rule below without
// knowing who's asking.
class AttendanceValidationError extends Error {}

// classId doesn't resolve to a real class via academicService.getClass
// — mirrors ClassTutorNotFoundError's precedent for "the referenced
// row doesn't exist," surfaced as a domain error rather than
// proceeding with a null class.
class AttendanceClassNotFoundError extends Error {}

// CLAUDE.md rule 7 / BusinessRules.md Academic-Timetable: "A class's
// attendance cannot be marked until its timetable status is
// Approved." See assertTimetableApproved below for what checking this
// "as stored" actually means in practice right now.
class AttendanceTimetableNotApprovedError extends Error {}

// BusinessRules.md Attendance: "Only the staff member scheduled for
// that period, the class tutor, or an HOD (force-mark) may mark
// attendance for a given hour." See assertCanMark below for which of
// those three this slice can actually verify.
class AttendanceForbiddenError extends Error {}

// BusinessRules.md Attendance: "Attendance cannot be modified after
// it is locked." Checked against the existing session's locked_at.
class AttendanceLockedError extends Error {}

// attendance_sessions_class_date_hour_key (the partial unique index)
// violated (Postgres 23505) on a raw INSERT race — markAttendance's
// own find-then-create/update flow avoids hitting this in the normal
// case (see below), so this only fires if two concurrent callers mark
// the identical (class_id, session_date, hour_index) at the same
// instant. Same defense-in-depth reasoning academicService.js gives
// for mapping its own rare-but-real constraint violations.
class AttendanceSessionConflictError extends Error {}

// CLAUDE.md rule 7's gate, checked against classes.timetable_status
// exactly as it's stored — no bypass, no "any non-Rejected status is
// good enough," no dev-mode shortcut. Module 3's fourth slice already
// flagged that nothing can set timetable_status to 'Approved' through
// any real API today (WorkflowService, Module 8, doesn't exist) — the
// direct, restated consequence here is that markAttendance is
// end-to-end unreachable for any class in real usage until that gap
// closes. That is the correct behavior for building services in
// Roadmap.md's locked dependency order, not a bug to work around:
// Attendance depends on Academic's approval state being real, and it
// isn't yet. Live verification of this check (see .ai/RESULT.md) has
// to set timetable_status via a raw UPDATE run directly against
// Postgres to reach the 'Approved' branch at all — exactly the kind
// of bypass no real service call is ever allowed to perform, done
// here only because it's the ERD-adjacent service layer being
// verified, not a route.
function assertTimetableApproved(cls) {
  if (cls.timetable_status !== 'Approved') {
    throw new AttendanceTimetableNotApprovedError(
      `class ${JSON.stringify(cls.id)} timetable_status is ${JSON.stringify(cls.timetable_status)}, not 'Approved'`,
    );
  }
}

// BusinessRules.md names three eligible actors. Two are verified here
// with real, structured data:
//   - "the class tutor" -> classes.tutor_user_id === actorUserId, a
//     real FK comparison (Module 3).
//   - "an HOD (force-mark)" -> actorRole === 'hod', trusted the same
//     way rbac.js trusts req.jwtClaims.role (a verified JWT claim, not
//     re-derived here).
// The third — "the staff member scheduled for that period" — is
// deliberately NOT verified in this slice. Doing so would require
// resolving classes.timetable_data's free-text grid cell (e.g.
// "DBMS (Dr. Amit)") to a real user_id, and nothing in this schema
// makes that resolution reliable: Module 3's first slice explicitly
// deferred building any subjects/faculty_allocation/timetable_periods
// structure ("the real, working frontend never queries a normalized
// subjects/periods table"), so the only available technique is the
// same fuzzy substring/normalize match TutorClass.jsx already does
// client-side (`normUser === normStaff || normStaff.includes(normUser)
// || normUser.includes(normStaff)`). Putting a heuristic text match
// behind an actual authorization decision — something that grants a
// real capability, not just a display hint — is a different and much
// riskier thing than the read-only "which subject is showing right
// now" display it's used for today; BusinessRules.md's own "final
// year" note already warns that this kind of soft text match is not a
// guaranteed structured filter. Until a real, structured
// faculty-allocation link exists, this leg of the rule is
// under-enforced on purpose: only the tutor or an HOD can mark today,
// which is a stricter (safer) subset of who BusinessRules.md actually
// allows, not a looser one. The practical consequence — ordinary
// scheduled teaching staff (StaffDashboard.jsx's primary real user)
// cannot yet mark their own periods through this service — is a real,
// named gap, not a silent one. See .ai/TASK.md.
function assertCanMark(cls, actorUserId, actorRole) {
  const isTutor = cls.tutor_user_id !== null && cls.tutor_user_id === actorUserId;
  const isHod = actorRole === 'hod';
  if (!isTutor && !isHod) {
    throw new AttendanceForbiddenError(
      `user ${JSON.stringify(actorUserId)} (role ${JSON.stringify(actorRole)}) may not mark attendance for class ${JSON.stringify(cls.id)}`,
    );
  }
}

// Creates a new session or re-marks an existing one for the same
// (classId, sessionDate, hourIndex) — StaffDashboard.jsx's real
// mark-period-attendance flow is a single "mark or update" action per
// period, not a separate create-then-update pair the caller has to
// orchestrate itself (its own "Mark Attendance"/"Update Attendance"
// button label is the same handler either way).
//
// absentStudentIds is JSON.stringify'd before being handed to the
// repository, deliberately, here and not inside
// attendanceRepository.js: node-postgres serializes a raw JS array
// parameter using Postgres's native ARRAY-literal format (`{a,b}`),
// not JSON syntax — passing one straight through to a jsonb column
// fails with a real `22P02 invalid input syntax for type json`, live-
// verified while building this slice (see .ai/RESULT.md).
// classRepository.js's timetable_data never needed this because that
// JSONB value is always a plain object, which pg does serialize as
// JSON automatically; auditLogRepository.createAuditLogEntry already
// established the same "stringify at the call site" pattern for its
// own JSONB `metadata` column.
async function markAttendance(
  client,
  { classId, sessionDate, hourIndex, absentStudentIds, totalStudents },
  { actorUserId, actorRole } = {},
) {
  if (!classId || !sessionDate || hourIndex === undefined || hourIndex === null
    || totalStudents === undefined || totalStudents === null) {
    throw new AttendanceValidationError('classId, sessionDate, hourIndex, and totalStudents are required');
  }
  if (!actorUserId || !actorRole) {
    throw new AttendanceValidationError('actorUserId and actorRole are required');
  }

  const cls = await academicService.getClass(client, classId);
  if (cls === null) {
    throw new AttendanceClassNotFoundError(`classId ${JSON.stringify(classId)} does not exist`);
  }

  assertTimetableApproved(cls);
  assertCanMark(cls, actorUserId, actorRole);

  const existing = await attendanceRepository.findByClassSessionAndHour(client, classId, sessionDate, hourIndex);

  const patch = {
    absentStudentIds: JSON.stringify(absentStudentIds || []),
    totalStudents,
    markedByUserId: actorUserId,
  };

  let session;
  let wasUpdate;
  if (existing !== null) {
    if (existing.locked_at !== null) {
      throw new AttendanceLockedError(`attendance session ${existing.id} is locked and cannot be modified`);
    }
    session = await attendanceRepository.update(client, existing.id, patch);
    wasUpdate = true;
  } else {
    try {
      session = await attendanceRepository.create(client, {
        collegeId: cls.college_id,
        classId,
        sessionDate,
        hourIndex,
        ...patch,
      });
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'attendance_sessions_class_date_hour_key') {
        throw new AttendanceSessionConflictError(
          `attendance for class ${JSON.stringify(classId)} on ${sessionDate} hour ${hourIndex} was just marked by someone else`,
        );
      }
      throw err;
    }
    wasUpdate = false;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: wasUpdate ? 'attendance_remarked' : 'attendance_marked',
    entity: 'attendance_sessions',
    entityId: session.id,
    metadata: null,
  });

  return session;
}

// null means no session exists with this id — not an error. The
// route turns that into 404, same as academicService.getClass.
async function getAttendanceSession(client, id) {
  return attendanceRepository.findById(client, id);
}

// The natural "this class's marked periods today" lookup
// StaffDashboard.jsx's real schedule screen needs — a thin wrapper,
// same shape as academicService.js leaving some classRepository
// lookups unwrapped in its own second slice, except this one is
// wrapped because a concrete future consumer (the schedule screen) is
// already known, not speculative.
async function listAttendanceSessionsForClassAndDate(client, classId, sessionDate) {
  return attendanceRepository.findByClassAndDate(client, classId, sessionDate);
}

module.exports = {
  AttendanceValidationError,
  AttendanceClassNotFoundError,
  AttendanceTimetableNotApprovedError,
  AttendanceForbiddenError,
  AttendanceLockedError,
  AttendanceSessionConflictError,
  markAttendance,
  getAttendanceSession,
  listAttendanceSessionsForClassAndDate,
};
