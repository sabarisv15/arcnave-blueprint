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
// here for real — see assertTimetableApproved and assertCanMark below
// for exactly how. Neither is worked around or faked.
//
// assertCanMark originally (82f8479) verified only two of
// BusinessRules.md's three eligible actors — class tutor and HOD —
// and explicitly refused to verify the third ("the staff member
// scheduled for that period") because nothing in the schema could
// resolve a timetable cell to a real user_id without heuristic text
// matching. That gap is now closed: a later Module 3 slice
// (facultyAllocationRepository.js/timetablePeriodRepository.js,
// `4fa8f12`, and academicService.js's business logic over them,
// `8b66a4c`) built the real, structured link — assertCanMark now
// composes academicService.getTimetablePeriodByDayAndHour and
// academicService.getFacultyAllocationForClassAndPeriod to check it
// for real. See assertCanMark's own comment for the exact
// composition, and its known, honest limitation: this only works once
// real timetable_periods/faculty_allocation rows exist, and nothing
// in this codebase populates them yet (no CSV-upload-to-normalized-
// rows path exists — flagged in `4fa8f12`'s own .ai/RESULT.md) — so in
// practice, today, this third leg still never actually grants access;
// it's real, live-verified code with no real data behind it yet, the
// same shape of gap assertTimetableApproved already has for a
// different reason.

const attendanceRepository = require('../repositories/attendanceRepository');
const attendanceCorrectionRepository = require('../repositories/attendanceCorrectionRepository');
const academicService = require('./academicService');
const studentService = require('./studentService');
const auditLogRepository = require('../repositories/auditLogRepository');
const workflowService = require('./workflowService');

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
// attendance for a given hour." See assertCanMark below for how all
// three are now verified.
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

// requestAttendanceCorrection given a session id with no matching row.
class AttendanceSessionNotFoundError extends Error {}

// requestAttendanceCorrection called on a session that isn't locked
// yet — BusinessRules.md Attendance correction: "before attendance is
// locked, routine corrections are allowed [directly, via markAttendance
// above]." The correction workflow exists specifically for the
// after-lock case; a caller correcting an unlocked session should use
// markAttendance directly instead.
class AttendanceNotLockedError extends Error {}

// Missing proposedTotalStudents, or missing actor identity — the
// correction's own required inputs, same "actor identity required to
// evaluate authorization/attribution" reasoning markAttendance's own
// AttendanceValidationError already gives.
class AttendanceCorrectionValidationError extends Error {}

// approveAttendanceCorrection/rejectAttendanceCorrection given a
// correction id with no matching row.
class AttendanceCorrectionNotFoundError extends Error {}

// approveAttendanceCorrection/rejectAttendanceCorrection called for a
// correction with no live Pending workflow_requests row (never
// submitted — not possible through requestAttendanceCorrection's own
// path — or already resolved).
class AttendanceCorrectionNoPendingRequestError extends Error {}

// markAttendanceByRollNumbers called for a staff member with no
// current, resolvable teaching session (outside teaching hours, or
// nothing scheduled this period) — BusinessRules.md AI Attendance
// Management's own "AI identifies the current class from the approved
// timetable" has nothing to identify.
class AttendanceNoActiveSessionError extends Error {}

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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// sessionDate is expected as an ISO date string ("YYYY-MM-DD", or a
// full ISO timestamp — only the first 10 characters are used), the
// same shape any real JSON request body would send. Parsed via
// explicit Date.UTC components, deliberately not `new Date(sessionDate).getDay()`:
// getDay() (not getUTCDay()) reads the *local* calendar day of
// whatever timezone this process runs in, which can silently roll a
// date-only string back or forward a day depending on the server's
// offset. Date.UTC + getUTCDay() is immune to that — live-verified
// against a known date while building this (see .ai/RESULT.md).
function dayOfWeekName(sessionDate) {
  const [year, month, day] = String(sessionDate).slice(0, 10).split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

// BusinessRules.md names three eligible actors. All three are now
// verified with real, structured data:
//   - "the class tutor" -> classes.tutor_user_id === actorUserId, a
//     real FK comparison (Module 3).
//   - "an HOD (force-mark)" -> actorRole === 'hod', trusted the same
//     way rbac.js trusts req.jwtClaims.role (a verified JWT claim, not
//     re-derived here).
//   - "the staff member scheduled for that period" -> resolved
//     structurally, not by the fuzzy free-text matching
//     TutorClass.jsx does client-side
//     (`normUser === normStaff || normStaff.includes(normUser) ||
//     normUser.includes(normStaff)`) that this function's own prior
//     version (82f8479) explicitly refused to copy into an
//     authorization decision. The real path: convert sessionDate to a
//     day-of-week name, look up that (college, day, hour)'s shared
//     timetable_periods row via academicService.getTimetablePeriodByDayAndHour,
//     then look up that (class, period)'s faculty_allocation row via
//     academicService.getFacultyAllocationForClassAndPeriod — if one
//     exists and its staff_user_id matches actorUserId, this actor is
//     genuinely the scheduled teacher, no heuristics involved.
//
// Both lookups return null gracefully (no period defined for that
// slot yet, or no allocation recorded for this class in it) rather
// than throwing — the honest, current-day consequence: since nothing
// in this codebase populates timetable_periods/faculty_allocation yet
// (no CSV-upload-to-normalized-rows path exists — flagged in
// `4fa8f12`'s own .ai/RESULT.md), this leg will almost always resolve
// to "no match" in real usage today, same as
// assertTimetableApproved's gate almost always resolving to "not
// Approved." Real, correct code; not yet exercised by real data. Not
// worked around here — see .ai/TASK.md.
async function assertCanMark(client, cls, sessionDate, hourIndex, actorUserId, actorRole) {
  const isTutor = cls.tutor_user_id !== null && cls.tutor_user_id === actorUserId;
  const isHod = actorRole === 'hod';
  if (isTutor || isHod) {
    return;
  }

  const period = await academicService.getTimetablePeriodByDayAndHour(client, cls.college_id, dayOfWeekName(sessionDate), hourIndex);
  if (period !== null) {
    const allocation = await academicService.getFacultyAllocationForClassAndPeriod(client, cls.id, period.id);
    if (allocation !== null && allocation.staff_user_id === actorUserId) {
      return;
    }

    // BusinessRules.md Substitute teacher provision: "AI recognizes the
    // substitute as authorized only for the assigned session" — a
    // fourth eligible marker alongside tutor/HOD/scheduled faculty,
    // scoped to this exact (period, date) pair only, per
    // academicService.getSubstituteAssignment's own comment. Composed
    // through AcademicService, never substituteAssignmentRepository
    // directly, same boundary the scheduled-faculty check above already
    // draws.
    const substitution = await academicService.getSubstituteAssignment(client, cls.id, period.id, sessionDate);
    if (substitution !== null && substitution.substitute_staff_user_id === actorUserId) {
      return;
    }
  }

  throw new AttendanceForbiddenError(
    `user ${JSON.stringify(actorUserId)} (role ${JSON.stringify(actorRole)}) may not mark attendance for class ${JSON.stringify(cls.id)}`,
  );
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
  await assertCanMark(client, cls, sessionDate, hourIndex, actorUserId, actorRole);

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

// The range counterpart of the exact-date lookup above — startDate/
// endDate are both optional, so omitting either (or both) means
// all-time for this class, not zero rows.
async function listAttendanceSessionsForClassInRange(client, classId, { startDate, endDate } = {}) {
  return attendanceRepository.findByClassAndDateRange(client, classId, { startDate, endDate });
}

// Sets locked_at, the flag markAttendance's own existing check already
// enforces (AttendanceLockedError). BusinessRules.md frames locking as
// time-based ("after the window closes") rather than a named human
// action — nothing in this codebase runs a scheduled job yet
// (background_jobs exists as a table/service but nothing populates an
// attendance-lock job today), so this is exposed as its own callable
// action for whatever eventually triggers it (a future background job,
// or manual use in the meantime) rather than guessed at with an
// invented cron schedule.
async function lockAttendanceSession(client, id, { actorUserId } = {}) {
  const session = await attendanceRepository.findById(client, id);
  if (session === null) {
    throw new AttendanceSessionNotFoundError(`attendance session ${JSON.stringify(id)} does not exist`);
  }
  if (session.locked_at !== null) {
    return session;
  }

  const locked = await attendanceRepository.update(client, id, { lockedAt: new Date().toISOString() });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: session.college_id,
    userId: actorUserId,
    action: 'attendance_locked',
    entity: 'attendance_sessions',
    entityId: id,
    metadata: null,
  });

  return locked;
}

// BusinessRules.md Attendance correction: "after attendance is locked,
// Subject Faculty submits a correction request; Class Tutor approves
// routine corrections." Single-step chain (Class Tutor) — "high-risk
// corrections follow the institution's configured approval workflow"
// is a real, separate rule this function doesn't implement: the
// configurable, per-institution approval-workflow engine
// BusinessRules.md's own Configurable Approval Workflow section
// describes doesn't exist yet in this codebase (no per-module,
// per-institution approver-chain configuration is read anywhere today
// — every chain in this codebase, this one included, is still
// hardcoded at the call site). Every correction here routes through
// the one routine (Tutor-only) chain until that engine exists to
// decide what counts as "high-risk" — a real, flagged gap, not a
// silent narrowing of the rule.
async function requestAttendanceCorrection(client, sessionId, {
  proposedAbsentStudentIds, proposedTotalStudents, reason,
}, { requestedByUserId, origin = 'human' } = {}) {
  if (proposedTotalStudents === undefined || proposedTotalStudents === null) {
    throw new AttendanceCorrectionValidationError('proposedTotalStudents is required');
  }
  if (!requestedByUserId) {
    throw new AttendanceCorrectionValidationError('requestedByUserId is required');
  }

  const session = await attendanceRepository.findById(client, sessionId);
  if (session === null) {
    throw new AttendanceSessionNotFoundError(`attendance session ${JSON.stringify(sessionId)} does not exist`);
  }
  if (session.locked_at === null) {
    throw new AttendanceNotLockedError(
      `attendance session ${JSON.stringify(sessionId)} is not locked — edit it directly via markAttendance instead`,
    );
  }

  const cls = await academicService.getClass(client, session.class_id);

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: session.college_id,
    entityType: 'attendance_correction',
    entityId: sessionId,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'tutor', user_id: cls.tutor_user_id }],
  });

  const correction = await attendanceCorrectionRepository.create(client, {
    collegeId: session.college_id,
    attendanceSessionId: sessionId,
    requestedByUserId,
    proposedAbsentStudentIds: JSON.stringify(proposedAbsentStudentIds || []),
    proposedTotalStudents,
    reason,
    workflowRequestId: workflowRequest.id,
  });

  return { workflowRequest, correction };
}

async function loadPendingCorrectionApproval(client, correctionId) {
  const correction = await attendanceCorrectionRepository.findById(client, correctionId);
  if (correction === null) {
    throw new AttendanceCorrectionNotFoundError(`attendance correction ${JSON.stringify(correctionId)} does not exist`);
  }
  if (correction.workflow_request_id === null) {
    throw new AttendanceCorrectionNoPendingRequestError(`attendance correction ${JSON.stringify(correctionId)} has no workflow request`);
  }
  const pending = await workflowService.getRequest(client, correction.workflow_request_id);
  if (pending === null || pending.status !== 'Pending') {
    throw new AttendanceCorrectionNoPendingRequestError(`attendance correction ${JSON.stringify(correctionId)} has no pending approval request`);
  }
  return { correction, pending };
}

// BusinessRules.md: "approved correction becomes the effective
// attendance value... all dependent attendance calculations are
// automatically recalculated." There is no percentage/shortage/report
// calculation reading attendance_sessions directly yet in this
// codebase to "recalculate" — getEffectiveAttendanceSession below is
// what any future such calculation is expected to read from, so it
// picks up an approved correction automatically the moment one exists,
// not a separate recalculation step to remember to run.
async function approveAttendanceCorrection(client, correctionId, { actorUserId, remarks } = {}) {
  const { correction, pending } = await loadPendingCorrectionApproval(client, correctionId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const applied = await attendanceCorrectionRepository.markApplied(client, correctionId);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'attendance_correction_approved',
    entity: 'attendance_corrections',
    entityId: correctionId,
    metadata: null,
  });

  return applied;
}

async function rejectAttendanceCorrection(client, correctionId, { actorUserId, remarks } = {}) {
  const { correction, pending } = await loadPendingCorrectionApproval(client, correctionId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'attendance_correction_rejected',
    entity: 'attendance_corrections',
    entityId: correctionId,
    metadata: null,
  });

  return correction;
}

async function listAttendanceCorrectionsForSession(client, sessionId) {
  return attendanceCorrectionRepository.listForSession(client, sessionId);
}

// BusinessRules.md: "AI uses the latest effective attendance value in
// operational reports [and] preserves original and corrected values for
// authorized audit views." The original session row (getAttendanceSession
// above) is untouched and always available for that audit view; this
// is the "latest effective value" half — the original's own fields,
// overridden by the latest approved correction's proposed values, if
// one exists.
async function getEffectiveAttendanceSession(client, sessionId) {
  const session = await attendanceRepository.findById(client, sessionId);
  if (session === null) {
    return null;
  }

  const latestApplied = await attendanceCorrectionRepository.findLatestApplied(client, sessionId);
  if (latestApplied === null) {
    return { ...session, effective: false };
  }

  return {
    ...session,
    absent_student_ids: latestApplied.proposed_absent_student_ids,
    total_students: latestApplied.proposed_total_students,
    effective: true,
    effective_correction_id: latestApplied.id,
  };
}

// BusinessRules.md AI Attendance Management: "faculty may send a
// natural language attendance message during the attendance window...
// AI identifies the current class from the approved timetable...
// specified roll numbers are marked Absent and all remaining enrolled
// students are marked Present." This is the one Business Service
// method the AI tool wraps (aiToolRegistry.js's own "no business logic
// in the handler" rule) — roll-number resolution and session lookup
// both happen here, not in the tool.
//
// Deliberately calls markAttendance (not attendanceRepository
// directly) to actually save the mark: markAttendance's own
// assertCanMark is the real authorization gate, re-verified here even
// though resolveCurrentSessionForStaff already found a matching
// allocation/substitution — defense in depth, not a redundant check,
// same reasoning every other service in this codebase gives for not
// trusting one lookup to also BE the authorization decision.
//
// Unknown roll numbers (typos, a student not in this class) are
// reported back, not silently dropped or hard-failed — the caller (the
// AI tool, then the LLM relaying it to the faculty member) decides
// what to do with "roll 999 doesn't exist in this class," not this
// function.
async function markAttendanceByRollNumbers(client, { absentRollNumbers }, { actorUserId, actorRole, collegeId } = {}) {
  if (!Array.isArray(absentRollNumbers)) {
    throw new AttendanceValidationError('absentRollNumbers must be an array');
  }
  if (!actorUserId || !actorRole || !collegeId) {
    throw new AttendanceValidationError('actorUserId, actorRole, and collegeId are required');
  }

  const session = await academicService.resolveCurrentSessionForStaff(client, collegeId, actorUserId);
  if (session === null) {
    throw new AttendanceNoActiveSessionError(
      `user ${JSON.stringify(actorUserId)} has no active teaching session right now`,
    );
  }

  const roster = await studentService.listStudentsForClass(client, session.classId);
  const rollToStudent = new Map(roster.map((s) => [s.roll_no, s]));

  const absentStudentIds = [];
  const unknownRollNumbers = [];
  for (const rollNo of absentRollNumbers) {
    const student = rollToStudent.get(String(rollNo));
    if (student === undefined) {
      unknownRollNumbers.push(rollNo);
    } else {
      absentStudentIds.push(student.id);
    }
  }

  const markedSession = await markAttendance(client, {
    classId: session.classId,
    sessionDate: session.sessionDate,
    hourIndex: session.hourIndex,
    absentStudentIds,
    totalStudents: roster.length,
  }, { actorUserId, actorRole });

  return { session: markedSession, unknownRollNumbers };
}

module.exports = {
  AttendanceValidationError,
  AttendanceClassNotFoundError,
  AttendanceTimetableNotApprovedError,
  AttendanceForbiddenError,
  AttendanceLockedError,
  AttendanceSessionConflictError,
  AttendanceSessionNotFoundError,
  AttendanceNotLockedError,
  AttendanceCorrectionValidationError,
  AttendanceCorrectionNotFoundError,
  AttendanceCorrectionNoPendingRequestError,
  AttendanceNoActiveSessionError,
  markAttendance,
  markAttendanceByRollNumbers,
  getAttendanceSession,
  listAttendanceSessionsForClassAndDate,
  listAttendanceSessionsForClassInRange,
  lockAttendanceSession,
  requestAttendanceCorrection,
  approveAttendanceCorrection,
  rejectAttendanceCorrection,
  listAttendanceCorrectionsForSession,
  getEffectiveAttendanceSession,
};
