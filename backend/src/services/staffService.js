'use strict';

// Business logic for Module 2's `staff` table — validation and audit
// logging on top of staffRepository.js, which does neither (CLAUDE.md
// rule 1: AI tools call Business Services, never repositories
// directly — this file is what makes that possible for staff).
//
// This slice assumes a `userId` for an already-existing `users` row
// is handed in for createStaff — it does not create accounts from
// scratch (`generatedCreds` in HodDashboard.jsx/PrincipalDashboard.jsx
// shows the old prototype's own version of this same step). That
// users-row-creation step is still a real, flagged gap — unchanged
// from the Module 2 first slice's .ai/TASK.md.
// "Only HOD/Principal may add staff" is an authorization rule, not
// business logic — left to the route/RBAC layer once Module 2's API
// exists, same reasoning studentService.js used for "only the class
// tutor may edit."
//
// The HOD/Principal approval chain (Module 8's second gap) is wired
// here: submitStaffRegistration/approveStaffRegistration/
// rejectStaffRegistration route through workflowService, per ADR-005/
// CLAUDE.md rule 3. findHodForDepartment/findPrincipal resolve real
// approver identities from the `staff`+`users` tables (staffRepository's
// own JOIN queries) — never a placeholder/hardcoded user id.
//
// Module 8's final slice: approveStaffRegistration's terminal Approved
// outcome now does the rest of BusinessRules.md's own sentence —
// "Staff ID is generated automatically -> credentials are emailed ->
// login is enabled only once credentials exist" — via assignStaffCode
// (this file), authService.activateUser (users is AuthService's table,
// not this file's — Architecture.md 2.5), and
// notificationService.sendStaffCredentialsEmail. This is the
// users-row-creation gap's *activation* half finally closing, not the
// whole gap: a `users` row (with SOME initial password_hash,
// is_active = false) must already exist by the time a staff profile
// exists at all (staff.user_id's own NOT NULL FK guarantees it) —
// activateUser overwrites that placeholder with a real, freshly
// generated password at the moment of approval, matching the old
// prototype's own generatedCreds shape (a username + a real password,
// shown/emailed at this exact step, not before). Who/what creates that
// initial `users` row in the first place (bulk-provisioning per
// BusinessRules' College Admin entry, presumably) is still not built —
// unchanged, still flagged, not this slice's job either.

const crypto = require('node:crypto');
const staffRepository = require('../repositories/staffRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const workflowService = require('./workflowService');
const authService = require('./authService');
const notificationService = require('./notificationService');

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

// submitStaffRegistration/approveStaffRegistration/rejectStaffRegistration
// given a staffId with no matching row — a required lookup (the
// staff row's own college_id/department drive the whole chain), not
// an optional fetch, same precedent workflowService.WorkflowRequestNotFoundError
// already set.
class StaffNotFoundError extends Error {}

// findHodForDepartment found no `staff` row in this department whose
// linked `users.role` is 'hod'. A real, surfaced gap (not silently
// defaulted to some other approver) — a department with no HOD
// assigned yet cannot have a registration request submitted against
// it until one exists.
class StaffHodNotFoundError extends Error {}

// findPrincipal found no `staff` row in this college whose linked
// `users.role` is 'principal'. Same reasoning as StaffHodNotFoundError.
class StaffPrincipalNotFoundError extends Error {}

// approveStaffRegistration/rejectStaffRegistration called for a
// staffId with no live Pending workflow_requests row (never submitted,
// or already resolved) — mirrors workflowService.WorkflowRequestNotFoundError's
// "a required lookup, not an optional fetch" shape.
class StaffRegistrationNotPendingError extends Error {}

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

// Resolves the real HOD of a department from staff+users — never a
// placeholder. Throws rather than returning null: a registration
// submission cannot build a valid approver_chain without this, same
// "required lookup" precedent createStaff's own error mapping already
// established for a bad FK.
async function findHodForDepartment(client, collegeId, department) {
  const hod = await staffRepository.findByCollegeDepartmentAndRole(client, collegeId, department, 'hod');
  if (hod === null) {
    throw new StaffHodNotFoundError(`no hod found for department ${JSON.stringify(department)}`);
  }
  return hod;
}

// Resolves the real Principal of a college from staff+users — same
// reasoning as findHodForDepartment.
async function findPrincipal(client, collegeId) {
  const principal = await staffRepository.findByCollegeAndRole(client, collegeId, 'principal');
  if (principal === null) {
    throw new StaffPrincipalNotFoundError(`no principal found for college ${JSON.stringify(collegeId)}`);
  }
  return principal;
}

// BusinessRules.md's Staff registration chain: Faculty submits ->
// HOD (of the department named on the request) approves -> Principal
// gives final approval. Modeled as a 2-step approver_chain, resolved
// here from real data (findHodForDepartment/findPrincipal), not
// hardcoded — CLAUDE.md rule 3/ADR-005: this is the same WorkflowService
// gate every other approval routes through.
//
// requestedByUserId is the actor submitting on the named staff
// member's behalf (per BusinessRules, "Faculty submits" — in this
// codebase's current placeholder RBAC, every staff write route is
// gated requireRole('principal') regardless, so who that concretely is
// today is a route-layer question, not this function's to assume).
async function submitStaffRegistration(client, staffId, { requestedByUserId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new StaffValidationError('requestedByUserId is required');
  }

  const staff = await staffRepository.findById(client, staffId);
  if (staff === null) {
    throw new StaffNotFoundError(`staff ${JSON.stringify(staffId)} does not exist`);
  }
  if (!staff.department) {
    throw new StaffValidationError(`staff ${JSON.stringify(staffId)} has no department set, cannot resolve an HOD approver`);
  }

  const hod = await findHodForDepartment(client, staff.college_id, staff.department);
  const principal = await findPrincipal(client, staff.college_id);

  return workflowService.submitRequest(client, {
    collegeId: staff.college_id,
    entityType: 'staff_registration',
    entityId: staff.id,
    requestedByUserId,
    origin,
    approverChain: [
      { step: 1, role: 'hod', user_id: hod.user_id },
      { step: 2, role: 'principal', user_id: principal.user_id },
    ],
  });
}

// Shared lookup for approve/reject: the staff row must exist, and
// exactly one live Pending workflow_requests row must govern it —
// workflowService.findPendingForEntity is the pure read this slice
// added to workflowService specifically for this correlation (see its
// own comment there).
async function loadPendingRegistration(client, staffId) {
  const staff = await staffRepository.findById(client, staffId);
  if (staff === null) {
    throw new StaffNotFoundError(`staff ${JSON.stringify(staffId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'staff_registration', staffId);
  if (pending === null) {
    throw new StaffRegistrationNotPendingError(`staff ${JSON.stringify(staffId)} has no pending registration request`);
  }

  return pending;
}

// Staff ID (staff_code) generation: no existing pattern to follow —
// checked studentRepository (students.roll_no) and staff.staff_code
// itself first, per this session's own task instruction; both are
// caller-supplied free text today, never auto-generated anywhere in
// this codebase. This is a fresh, minimal pattern:
// `STF-<year>-<6 hex chars>`, retried on a real
// staff_college_id_staff_code_key collision (the existing UNIQUE
// constraint, not a pre-check — same "let the DB be the actual
// backstop" discipline every other conflict error in this codebase
// already follows) up to a few attempts.
const STAFF_CODE_MAX_ATTEMPTS = 5;

function generateStaffCode() {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `STF-${year}-${suffix}`;
}

async function assignStaffCode(client, staffId) {
  for (let attempt = 0; attempt < STAFF_CODE_MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await staffRepository.update(client, staffId, { staffCode: generateStaffCode() });
    } catch (err) {
      const isLastAttempt = attempt === STAFF_CODE_MAX_ATTEMPTS - 1;
      if (err.code === '23505' && err.constraint === 'staff_college_id_staff_code_key' && !isLastAttempt) {
        continue; // eslint-disable-line no-continue
      }
      throw err;
    }
  }
  return undefined; // unreachable — satisfies eslint's consistent-return
}

// The rest of BusinessRules.md's own sentence, fired only on the
// workflow's TERMINAL Approved outcome (the Principal's own final
// sign-off) — never on an intermediate step advance (e.g. the HOD's
// own approval, which only ever advances current_step and leaves
// status 'Pending'). resolved.status is what distinguishes "the chain
// just advanced" from "the chain just closed"; loadPendingRegistration/
// workflowService.approveRequest already guarantee ADR-005's
// self-approval rule and the correct-actor-for-this-step check ran
// before any of this executes.
//
// Order matters: staff_code first (a staffService-owned mutation),
// then authService.activateUser (users is AuthService's table, not
// this file's — Architecture.md 2.5), then the email — composing the
// message needs both the fresh staffCode and the fresh plainPassword,
// so it has to be last. A failed email (see notificationService.js's
// own file-level comment) never rolls any of this back — activation is
// the real business outcome; delivery is best-effort.
async function approveStaffRegistration(client, staffId, { actorUserId, remarks } = {}) {
  const pending = await loadPendingRegistration(client, staffId);
  const resolved = await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  if (resolved.status !== 'Approved') {
    // Still mid-chain (e.g. just the HOD's own step) — nothing to
    // activate yet.
    return { workflowRequest: resolved, staff: await staffRepository.findById(client, staffId) };
  }

  const staff = await assignStaffCode(client, staffId);
  const { user, plainPassword } = await authService.activateUser(client, staff.user_id, { activatedBy: actorUserId });

  await notificationService.sendStaffCredentialsEmail(client, {
    to: user.email,
    username: user.username,
    password: plainPassword,
    staffCode: staff.staff_code,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId: actorUserId,
    action: 'staff_activated',
    entity: 'staff',
    entityId: staff.id,
    metadata: null,
  });

  return { workflowRequest: resolved, staff };
}

async function rejectStaffRegistration(client, staffId, { actorUserId, remarks } = {}) {
  const pending = await loadPendingRegistration(client, staffId);
  return workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });
}

module.exports = {
  StaffValidationError,
  StaffUserConflictError,
  StaffCodeConflictError,
  StaffUserNotFoundError,
  StaffNotFoundError,
  StaffHodNotFoundError,
  StaffPrincipalNotFoundError,
  StaffRegistrationNotPendingError,
  createStaff,
  getStaff,
  updateStaff,
  removeStaff,
  listStaff,
  findHodForDepartment,
  findPrincipal,
  submitStaffRegistration,
  approveStaffRegistration,
  rejectStaffRegistration,
};
