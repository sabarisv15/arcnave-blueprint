'use strict';

// Business logic for Module 2's `staff` table — validation and audit
// logging on top of staffRepository.js, which does neither (CLAUDE.md
// rule 1: AI tools call Business Services, never repositories
// directly — this file is what makes that possible for staff).
//
// This slice assumes a `userId` for an already-existing `users` row
// is handed in — it does not create accounts, run the HOD/Principal
// approval chain, or generate credentials (`generatedCreds` in
// HodDashboard.jsx/PrincipalDashboard.jsx). That's WorkflowService
// (Module 8) plus a users-row-creation step, neither of which exists
// yet — same scope boundary the Module 2 first slice's .ai/TASK.md
// already drew. "Only HOD/Principal may add staff" is an
// authorization rule, not business logic — left to the route/RBAC
// layer once Module 2's API exists, same reasoning studentService.js
// used for "only the class tutor may edit."

const staffRepository = require('../repositories/staffRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

// Missing userId or fullName — staff.user_id and staff.full_name are
// both NOT NULL at the DB level. Raised before any repository call,
// same as studentService's pre-query guard.
class StaffValidationError extends Error {}

// UNIQUE (user_id) violated (Postgres 23505, staff_user_id_key) — this
// userId already has a staff profile. Never let the raw pg error
// reach the caller, same discipline as StudentRollNoConflictError.
class StaffUserConflictError extends Error {}

// UNIQUE (college_id, staff_code) violated (Postgres 23505,
// staff_college_id_staff_code_key) — this staffCode is already taken
// in this college. Kept distinct from StaffUserConflictError rather
// than bundled the way platformService.js's DuplicateCollegeError
// bundles colleges' two UNIQUE constraints: those two both mean "this
// college already exists" to a caller, but a staff user_id conflict
// ("this person already has a profile") and a staff_code conflict
// ("that code is taken, pick another") are different failures with
// different remedies, so collapsing them would lose information a
// future route/UI layer will want. Distinguished via err.constraint,
// not by re-parsing err.message (live-verified against the real
// Docker Postgres that node-postgres populates err.constraint with
// the exact constraint name on a 23505).
class StaffCodeConflictError extends Error {}

// staff_user_id_fkey (staff.user_id -> users.id) violated (Postgres
// 23503) — the given userId doesn't exist in users. Follows
// platformService.js's CollegeNotFoundError precedent: staff has
// exactly one FK a caller could violate via createStaff's inputs
// (college_id comes from the tenant-scoped request context, not
// caller-supplied free text), so any 23503 here unambiguously means
// this, no separate existence check needed.
class StaffUserNotFoundError extends Error {}

// The fields this service accepts for create/update, deliberately
// listed here rather than trusting staffRepository's own COLUMNS
// whitelist to be the only line of defense — same defense-in-depth
// reasoning as studentService.js's ALLOWED_FIELDS. collegeId and
// userId are excluded from what updateStaff accepts: a staff
// profile's tenant and account linkage are set once at creation and
// never move via update, same as studentService's exclusion of
// collegeId. There is no aadhaar entry here and there never should be
// (CLAUDE.md rule 8) — any aadhaar-shaped field a caller sends is
// silently dropped by pickStaffFields, not rejected with an error,
// same reasoning studentService.js already settled on.
const ALLOWED_FIELDS = [
  'staffCode',
  'fullName',
  'gender',
  'dob',
  'phone',
  'department',
  'designation',
  'qualification',
  'hasPhd',
  'aicteId',
  'joinedYear',
  'address',
];

function pickStaffFields(source) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

// `userId` here is the staff row's OWN account link (staff.user_id —
// the profile being created), not necessarily who is performing the
// create. Those are genuinely different people in the real flow this
// slice is grounded against (a principal/HOD adds a profile for an
// already-provisioned staff member — see HodDashboard.jsx/
// PrincipalDashboard.jsx's Add Staff modal): the actor is whoever is
// authenticated on the request, the subject is the staff member named
// in the body. `actorUserId` is who the audit_log entry attributes
// the action to; it's optional (falls back to `undefined`, which
// audit_log.user_id accepts — it's a nullable column) rather than
// required, since a future caller invoking this outside an
// authenticated route (a script, a future bulk-import path) may have
// no separate actor to name. This is a correction to this slice's own
// prior signature, found while wiring the route layer for it — see
// .ai/RESULT.md.
async function createStaff(client, { collegeId, userId, fullName, ...rest }, { actorUserId } = {}) {
  if (!userId || !fullName) {
    throw new StaffValidationError('userId and fullName are required');
  }

  let staff;
  try {
    staff = await staffRepository.create(client, {
      collegeId,
      userId,
      fullName,
      ...pickStaffFields(rest),
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'staff_user_id_key') {
      throw new StaffUserConflictError(`userId ${JSON.stringify(userId)} already has a staff profile`);
    }
    if (err.code === '23505' && err.constraint === 'staff_college_id_staff_code_key') {
      throw new StaffCodeConflictError(`staff_code ${JSON.stringify(rest.staffCode)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'staff_user_id_fkey') {
      throw new StaffUserNotFoundError(`userId ${JSON.stringify(userId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'staff_created',
    entity: 'staff',
    entityId: staff.id,
    metadata: null,
  });

  return staff;
}

// null means no staff profile exists with this id — not an error. The
// route turns that into 404, same as studentService.getStudent.
async function getStaff(client, id) {
  return staffRepository.findById(client, id);
}

async function updateStaff(client, id, fields, { userId }) {
  const patch = pickStaffFields(fields);
  const hasChanges = Object.keys(patch).length > 0;

  let staff;
  try {
    staff = await staffRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'staff_college_id_staff_code_key') {
      throw new StaffCodeConflictError(`staff_code ${JSON.stringify(patch.staffCode)} already exists for this college`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // staffRepository.update falls back to a plain findById then).
  // staff !== null guards the id-not-found case. Either way, no row
  // was actually changed, so no audit entry.
  if (hasChanges && staff !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: staff.college_id,
      userId,
      action: 'staff_updated',
      entity: 'staff',
      entityId: id,
      metadata: null,
    });
  }

  return staff;
}

// Looks the staff row up first, both to get collegeId for the audit
// entry (removeStaff's signature, per .ai/TASK.md, takes no collegeId
// of its own) and to avoid logging a removal for an id that never
// existed. Still a hard DELETE, not a soft-delete: the ERD has no
// soft-delete column yet — unchanged open question from the first
// slice, not resolved here either.
async function removeStaff(client, id, { userId }) {
  const staff = await staffRepository.findById(client, id);
  if (staff === null) {
    return null;
  }

  await staffRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId,
    action: 'staff_removed',
    entity: 'staff',
    entityId: id,
    metadata: null,
  });

  return staff;
}

async function listStaff(client, { limit, offset } = {}) {
  return staffRepository.list(client, { limit, offset });
}

module.exports = {
  StaffValidationError,
  StaffUserConflictError,
  StaffCodeConflictError,
  StaffUserNotFoundError,
  createStaff,
  getStaff,
  updateStaff,
  removeStaff,
  listStaff,
};
