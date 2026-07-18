'use strict';

// Business logic for `academic_years` — validation, lifecycle-
// transition rules, and audit logging on top of academicYearRepository,
// which does neither (CLAUDE.md rule 1: AI tools call Business
// Services, never repositories directly — this file is what makes that
// possible for Academic Year).
//
// BusinessRules.md Academic/Timetable — Academic Year: "an institution
// operates under exactly one Active Academic Year at a time (lifecycle:
// Draft -> Active -> Closed -> Archived)... Only the Principal may
// request lifecycle transitions." The Principal-only part is enforced
// at the route/RBAC layer (requirePermission('academic_years.*'),
// mapped to ['principal'] in middleware/permissions.js), not here —
// same division every other service in this codebase draws. What IS
// enforced here is that the transition itself is legal regardless of
// who's calling: Draft -> Active -> Closed -> Archived only, never
// skipped, never reversed.
//
// "College Admin executes the configuration change on Principal's
// approved request" (BusinessRules.md Multi-tenancy) describes how an
// ARCNAVE support employee might physically perform this action on the
// Principal's behalf through a separate, audited platform-side
// mechanism — that mechanism doesn't exist yet (see BusinessRules.md's
// College Admin section and the platform-access flow it describes).
// Until it's built, the Principal's own account performs these actions
// directly; this service has no College Admin-specific code path to
// omit or stub, because there is nothing tenant-side for it to call —
// the whole point of that model is that College Admin acts through a
// platform mechanism outside this codebase's tenant RBAC, not through
// a role check in here.

const academicYearRepository = require('../repositories/academicYearRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

// Missing collegeId or yearLabel — academic_years' own NOT NULL
// columns (aside from college_id, which always comes from tenant-
// scoped request context, never caller free text).
class AcademicYearValidationError extends Error {}

// academic_years_college_year_label_key violated (Postgres 23505) —
// this college already has an academic year with this exact label.
class AcademicYearLabelConflictError extends Error {}

// academic_years_one_active_per_college violated (Postgres 23505) —
// activateAcademicYear called while another row for this college is
// already Active. BusinessRules.md: "previous Academic Years must be
// Closed before a new Academic Year becomes Active" — this is that
// rule's real enforcement, at the DB layer, not guessed at here.
class AcademicYearActiveConflictError extends Error {}

// activateAcademicYear/closeAcademicYear/archiveAcademicYear/
// getAcademicYear given an id with no matching row.
class AcademicYearNotFoundError extends Error {}

// activateAcademicYear called on a non-Draft row, closeAcademicYear on
// a non-Active row, or archiveAcademicYear on a non-Closed row — the
// lifecycle only ever moves forward, one step at a time, per
// BusinessRules.md's own stated order.
class AcademicYearTransitionError extends Error {}

async function createAcademicYear(client, { collegeId, yearLabel, startDate, endDate }, { actorUserId } = {}) {
  if (!collegeId || !yearLabel) {
    throw new AcademicYearValidationError('collegeId and yearLabel are required');
  }

  let academicYear;
  try {
    academicYear = await academicYearRepository.create(client, {
      collegeId, yearLabel, startDate, endDate, createdByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'academic_years_college_year_label_key') {
      throw new AcademicYearLabelConflictError(
        `an academic year labelled ${JSON.stringify(yearLabel)} already exists for this college`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'academic_year_created',
    entity: 'academic_years',
    entityId: academicYear.id,
    metadata: null,
  });

  return academicYear;
}

async function getAcademicYear(client, id) {
  return academicYearRepository.findById(client, id);
}

// BusinessRules.md: "AI defaults to the Active Academic Year unless
// another year is explicitly requested" — the one lookup every other
// module (attendance, timetable, exams, marks, fees, reports) needs to
// resolve "which academic year does this belong to" when the caller
// doesn't name one explicitly.
async function getActiveAcademicYear(client, collegeId) {
  return academicYearRepository.findActive(client, collegeId);
}

async function listAcademicYears(client, { limit, offset } = {}) {
  return academicYearRepository.list(client, { limit, offset });
}

async function loadAcademicYearOrThrow(client, id) {
  const academicYear = await academicYearRepository.findById(client, id);
  if (academicYear === null) {
    throw new AcademicYearNotFoundError(`academic year ${JSON.stringify(id)} does not exist`);
  }
  return academicYear;
}

async function activateAcademicYear(client, id, { actorUserId } = {}) {
  const academicYear = await loadAcademicYearOrThrow(client, id);
  if (academicYear.status !== 'Draft') {
    throw new AcademicYearTransitionError(
      `academic year ${JSON.stringify(id)} is ${JSON.stringify(academicYear.status)}, not Draft — cannot activate`,
    );
  }

  let updated;
  try {
    updated = await academicYearRepository.update(client, id, { status: 'Active' });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'academic_years_one_active_per_college') {
      throw new AcademicYearActiveConflictError(
        `college ${JSON.stringify(academicYear.college_id)} already has an active academic year — close it first`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: academicYear.college_id,
    userId: actorUserId,
    action: 'academic_year_activated',
    entity: 'academic_years',
    entityId: id,
    metadata: null,
  });

  return updated;
}

async function closeAcademicYear(client, id, { actorUserId } = {}) {
  const academicYear = await loadAcademicYearOrThrow(client, id);
  if (academicYear.status !== 'Active') {
    throw new AcademicYearTransitionError(
      `academic year ${JSON.stringify(id)} is ${JSON.stringify(academicYear.status)}, not Active — cannot close`,
    );
  }

  const updated = await academicYearRepository.update(client, id, { status: 'Closed' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: academicYear.college_id,
    userId: actorUserId,
    action: 'academic_year_closed',
    entity: 'academic_years',
    entityId: id,
    metadata: null,
  });

  return updated;
}

async function archiveAcademicYear(client, id, { actorUserId } = {}) {
  const academicYear = await loadAcademicYearOrThrow(client, id);
  if (academicYear.status !== 'Closed') {
    throw new AcademicYearTransitionError(
      `academic year ${JSON.stringify(id)} is ${JSON.stringify(academicYear.status)}, not Closed — cannot archive`,
    );
  }

  const updated = await academicYearRepository.update(client, id, { status: 'Archived' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: academicYear.college_id,
    userId: actorUserId,
    action: 'academic_year_archived',
    entity: 'academic_years',
    entityId: id,
    metadata: null,
  });

  return updated;
}

module.exports = {
  AcademicYearValidationError,
  AcademicYearLabelConflictError,
  AcademicYearActiveConflictError,
  AcademicYearNotFoundError,
  AcademicYearTransitionError,
  createAcademicYear,
  getAcademicYear,
  getActiveAcademicYear,
  listAcademicYears,
  activateAcademicYear,
  closeAcademicYear,
  archiveAcademicYear,
};
