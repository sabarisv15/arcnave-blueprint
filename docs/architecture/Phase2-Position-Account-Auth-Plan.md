# Phase 2 (Revised): Position Account Authentication

**Status: revised plan, supersedes the first draft. Nothing implemented yet.**
Verified directly against the current tree (commit `a0fdf4c`).

## Context

Phase 1 (shipped) wired the *read* side of ADR-021's Position model:
`identityService.resolveCapabilities(userId)` is a frozen façade
(ADR-022) every consumer (authorization, workflow, visibility, audit)
trusts. This phase makes Position Accounts actually loggable-into —
and, after two corrections made mid-planning, covers more ground than
first scoped:

1. **Office = permanent seat, person = temporary occupant** (user's own
   framing). Principal, HOD, and a Class/section ("ECE 2nd Year") are
   the same kind of thing — the seat's account, not the person's.
2. **Authorization must scope to the specific office**, never unioned
   with whatever else the same occupant holds elsewhere.
3. **Class Tutor is a full replacement**, not a bolt-on: `classes.
   tutor_user_id` (today a bare FK to `users`, globally UNIQUE) becomes
   a real Position — Level 4, `position_type='class_tutor'` (NOT a new
   level — see decision 6) — following the exact same
   Position/Account/Occupant model HOD already uses.

## Locked decisions

1. Scope: Level 1 (Principal), Level 2 (institution-configured), Level
   3 (HOD), and Level 4 positions carrying `position_type='class_tutor'`
   get Position Account login. Plain Level 4 staff (no assignment, no
   Position row at all) are unaffected and keep their existing meaning.
2. Two separate logins per person, by design.
3. Invite-based credential bootstrap, recursive by scope:
   Platform Admin → Level 1/2. Level 2 → HOD (Level 3) within their own
   scope. **HOD → Class Tutor (Level 4 + `position_type='class_tutor'`)
   within their own department's classes only.**
4. **Authorization resolves per-office.** A Position Account session
   returns only that one position's own capabilities — a new function,
   `identityService.resolveCapabilitiesForPosition(client,
   {positionAccountId})`, sits *alongside* the frozen
   `resolveCapabilities(userId)`, never modifying it. The session token
   for a Position Account carries `sub: positionAccountId` (not a
   userId) specifically so there's no `userId` to accidentally union
   against.
5. Reassignment lifecycle (ADR-021 §10) is in scope, uniformly across
   Level 1/2/3 and the Class Tutor assignment — one shared function,
   not per-type copies.
6. **Class Tutor: full replacement, but NOT a new level** (corrected
   after review — levels represent organizational hierarchy;
   assignments like Class Tutor, Placement Coordinator, NSS
   Coordinator, Library In-charge, Exam Cell are all things a Level 4
   Staff position carries, not separate rungs). `positions.level` CHECK
   stays `1-4`, unchanged. A new `position_type` column on `positions`
   (nullable, e.g. `'class_tutor'`) distinguishes an assignment-bearing
   Level 4 position from plain staff (no Position row at all, unchanged
   from today). A new `position_class_assignments` table mirrors
   `position_department_assignments` exactly, FK'd to `classes(id)`,
   linking a `position_type='class_tutor'` position to its class.
   ADR-021's "Level 4 is person-centric, no Position ever created" gets
   a narrow, explicit carve-out: a Level 4 Position row now CAN exist,
   but only when it carries a real `position_type` assignment — plain
   staff with no such assignment still get zero Position rows. This
   also keeps the schema open for future assignment types (Placement
   Coordinator, NSS Coordinator, Library In-charge, Exam Cell) without
   inventing a new level for each one.
7. Class Tutor assignment/reassignment is **HOD-only, scoped to their
   own department** — supersedes today's `PATCH /classes/:id`
   (Principal-only `classes.update`) as the path that sets a class's
   tutor. Code comments in `routes/classes.js` (~lines 144-157) already
   flagged this exact gap as expected future work.
8. Position Account MFA enrollment stays deferred — columns exist, no
   enrollment UX exists anywhere yet to fork from.
9. Reassignment's credential reset uses the same **invite-based**
   mechanism as initial bootstrap (a fresh `position_account_invitations`
   row), not a mailed temp password — a deliberate, documented amendment
   to ADR-021 §10's literal wording ("issue a temporary password"),
   kept internally consistent with decision 3.

## Ground truth already confirmed in the repo

- `positions.level` CHECK is `BETWEEN 1 AND 4`
  (`backend/migrations/1756900000000_position-schema.js:61`) — **stays
  unchanged this phase**, no widening. Class Tutor is Level 4 +
  `position_type='class_tutor'`, not a new level (corrected design,
  see decision 6).
- `identityService.resolveCapabilities` (`identityService.js:88-121`)
  and `resolvePositionOccupant` (`identityService.js:139-148`, built on
  `positionSlotResolver.resolvePositionForSlot`) — the latter only
  resolves `{collegeId, level}` or `{departmentId}` today; **no class
  variant exists yet.**
- `middleware/identity.js:28-51` branches only on `claims.type !==
  'access'` — exactly one token type exists today.
- `middleware/sessionRevocation.js:23-37` keys off
  `authService.getCurrentTokenVersion(client, claims.sub)` →
  `users.token_version`. `position_accounts.token_version` exists,
  unused — needs its own lookup path, not a reuse.
- `positionRepository.js` has no lookup by `official_email`, no
  credential/token-version update helpers, no MFA/recovery clear, no
  class-assignment mirror of the department-assignment trio.
- `staffService.ensureHodPosition`/`swapHodOccupant`
  (`staffService.js:277-322`) is the exact pattern to mirror for Class
  Tutor, including its placeholder-email/placeholder-password
  provisioning convention.
- `authService.acceptInvitation`/`provisionLevel1PositionForNewPrincipal`
  (`authService.js:619-703`) and `routes/invitations.js` are the
  existing invite-token→accept pattern to reuse (SHA-256 token hash via
  `security.hashRefreshToken`, raw token never in API responses,
  generic error on any invalid/expired/used/revoked state).
- `tests/helpers/positionFixtures.js` (`seedPrincipalPosition`,
  `seedHodPosition`, `cleanupPositionRows`) is the fixture pattern
  `seedClassTutorPosition` extends.
- `workflowChainService.js:53,61,68,103-111` resolves `'tutor'` chain
  role directly from `cls.tutor_user_id`.
- `classRepository.js:31-75` (`COLUMNS` includes `tutor_user_id`;
  `findByTutorUserId`, no college filter — relies on global UNIQUE).
- `PERMISSION_ROLES['classes.update'] = ['principal']`
  (`middleware/permissions.js:50`) is the sole gate on `PATCH
  /classes/:id`, the only route that can set `tutor_user_id` today.

## Class Tutor's exact current blast radius (all must migrate off the raw column)

| Site | What it does today |
|---|---|
| `academicService.js` `ALLOWED_FIELDS`/`createClass`/`updateClass` (lines 280-289, 326-331, 375-380) | `tutorUserId` is a plain patchable field; catches `23505`→`ClassTutorConflictError`, `23503`→`ClassTutorNotFoundError` |
| `academicService.js` `sendClassAlert` (1157-1210, gate 1166-1168) | `cls.tutor_user_id !== actorUserId` → `ClassSendAlertNotTutorError` |
| `attendanceService.js` `assertCanMark` (line 195) | `isTutor = cls.tutor_user_id === actorUserId`, one of several ways to pass |
| `attendanceService.js` `requestAttendanceCorrection` (line 412) | approver chain `{step:1, role:'tutor', user_id: cls.tutor_user_id}` |
| `examinationService.js` `assertIsTutor` (51-60) | `cls.tutor_user_id !== actorUserId` → `ExaminationNotTutorError` |
| `financeService.js` `recordScholarshipDecision` (~583) | `cls.tutor_user_id !== actorUserId` → `ScholarshipDecisionNotTutorError` |
| `studentService.js` `createStudent`(228)/`assertCanModifyStudent`(365) | `classRepository.findByTutorUserId(client, userId)` — reverse (user→class) direction |
| `identity/visibilityResolver.js` `resolveAssignedClassIds` (line 66) | already part of Phase 1's façade; populates `resolveCapabilities`'s `assignedClassIds` for base-level staff |
| `classRepository.js` (`COLUMNS` line 37, `findByTutorUserId` 69-75) | also called from `staffService.js:536`'s `deactivateStaff` |
| `routes/classes.js` | `PATCH /classes/:id` is the only route that sets `tutor_user_id` |

**12 test files pin this exact behavior** (UNIQUE-conflict→409,
FK-not-found→404, exact actor comparison, `null`/no-tutor as a valid
state): `send-class-alert.test.js`, `examination-service.test.js`,
`scholarship-decision-service.test.js`, `attendance-service.test.js`,
`attendance-correction-service.test.js`, `workflow-chain-service.test.js`,
`student-service.test.js`, `staff-lifecycle-service.test.js`,
`visibility-service.test.js`, `classes.test.js`,
`academic-service.test.js`, `faculty-allocation.test.js` (fixture only).

## Schema / migrations

Reversible, additive-first, RLS+tenant_isolation+`SELECT,INSERT,UPDATE`
grant on every new table (no DELETE), matching every ledger table in
`1756900000000_position-schema.js`.

- **A — add `position_type` column to `positions`.** `ALTER TABLE
  positions ADD COLUMN position_type TEXT;` (nullable — `NULL` means
  "plain position, no special assignment," e.g. Principal/Level2/HOD
  rows; `'class_tutor'` marks a Level 4 position carrying that
  assignment). No CHECK enum for now — the value space is expected to
  grow (Placement Coordinator, NSS Coordinator, Library In-charge, Exam
  Cell are named future assignments), so validate the allowed set in
  application code, not the database, matching this codebase's general
  preference for business rules living in services rather than DB
  constraints wherever the rule is expected to evolve. `down()`: `DROP
  COLUMN position_type`.
- **B — `position_class_assignments`.** Exact mirror of
  `position_department_assignments`, FK'd to `classes(id)`, same
  partial-unique "one active position per class" index.
- **C — `position_account_invitations`.** ONE generic table across
  L1/L2/L3/Class-Tutor (not four separate tables): `id, college_id,
  position_id, level CHECK 1-4, position_type, email, token_hash
  UNIQUE, created_by (a real users.id — the inviting occupant),
  expires_at, accepted_at, revoked_at, created_at`. `level`/
  `position_type` are denormalized so the recursive invite-guard can
  check eligibility straight off the invitation row.
- **D (separate, later) — drop `classes.tutor_user_id`** and its
  UNIQUE/FK constraints, only once every reader below is migrated and
  green. `down()` re-adds the column but does NOT attempt to backfill
  data — documented as a real, non-lossless rollback.
- **E — `position_account_refresh_tokens`.** Structurally identical to
  `refresh_tokens`, scoped to `position_account_id`.

## Repository additions

`positionRepository.js`: `findPositionAccountByOfficialEmail`,
`findPositionAccountById`, `updatePositionAccountCredentials`,
`incrementPositionAccountTokenVersion`, `getPositionAccountTokenVersion`,
`clearPositionAccountMfaAndRecovery`, `createPositionClassAssignment`/
`findActiveClassAssignment`/`revokePositionClassAssignment` (mirror the
department trio), `findActiveClassAssignmentsForPosition`.

New `positionAccountInvitationRepository.js` — mirrors
`principalInvitationRepository.js`: `createInvitation`,
`getInvitationByTokenHash`, `markInvitationAccepted`, `revokeInvitation`,
`listInvitationsForPosition`. Build `resendInvitation`-equivalent at the
repo layer now (cheap); defer the route/UI exposure unless requested.

## New position-scoped capability resolution (the core of decision 4)

New sibling function on `identityService.js` — **not** a change to
`resolveCapabilities`'s shape:

```js
async function resolveCapabilitiesForPosition(client, { positionAccountId }) {
  // account -> its own position only, never user -> all positions
}
```

Composes existing internal resolvers (`moduleResolver`,
`departmentResolver`, a new tiny `classResolver` mirroring
`departmentResolver.js`, `assignmentResolver`) against ONE position,
never unioned with any other position the same occupant holds. Returns:

```js
{
  positionAccountId, positionId, level, positionType, title, collegeId,
  currentOccupantUserId,
  moduleKeys: string[],
  departmentIds: string[],   // [] unless level 2/3
  classIds: string[],        // [] unless level===4 && positionType==='class_tutor'
  effectiveRole: 'principal'|'level2'|'hod'|'class_tutor'|'staff',
  scopeLevel: 'college'|'department'|'class',
}
```

`effectiveRole`/`scopeLevel` derive purely from this one position's
`level` + `position_type` — a small new pure function beside this
resolver, NOT a reuse of the person-wide
`deriveEffectiveRole`/`visibilityResolver` logic (reusing those would
reintroduce the exact union this decision forbids). Derivation:
level 1→`'principal'`/college, level 2→`'level2'`/department, level
3→`'hod'`/department, level 4 with `position_type==='class_tutor'`→
`'class_tutor'`/class. (Level 4 with no `position_type` shouldn't reach
this resolver at all — plain staff never get a `position_accounts` row
to log into in the first place.)

**`middleware/identity.js`** branches on `claims.type`: `'access'` →
`resolveCapabilities(userId)` (unchanged); `'position_access'` →
`resolveCapabilitiesForPosition(positionAccountId)`. `claims.sub` for a
Position Account token IS the `position_account_id` — there is no
`userId` in the claim to accidentally union against.

**`middleware/sessionRevocation.js`** gets the same type branch:
`'position_access'` checks `getCurrentPositionAccountTokenVersion`
against `position_accounts.token_version` instead of `users.token_version`.

`rbac.js`'s `requirePermission` needs no change — it already just reads
`req.capabilities.effectiveRole` regardless of which branch produced
it. `PERMISSION_ROLES` needs new entries for `'level2'`/`'class_tutor'`.

## Service layer

**New `positionAccountAuthService.js`** (one generic service covering
L1/L2/L3/Class-Tutor, not four): `login` (lookup by email → verify password →
generic error on any failure → mint `{sub: positionAccountId,
college_id, token_version, type: 'position_access'}`, no `role` claim —
role is derived fresh every request from live position state, never
trusted from the token), `refresh`/`revoke` mirroring `authService`'s
exactly, `assertLevelAllowsPositionLogin` guard.

**New `positionAccountInvitationService.js`** — one recursive,
level-parametrized invite/accept flow, not four bespoke ones:

```js
const RECURSIVE_INVITERS = {
  1: { scopeCheck: 'platform_admin' },
  2: { scopeCheck: 'platform_admin' },
  3: { requiredActorLevel: 2, scopeCheck: 'sameCollegeAnyDept' },
  'class_tutor': { requiredActorLevel: 3, scopeCheck: 'ownDepartmentOnly' }, // level 4 + position_type
};
```

For level 3/class-tutor invites, the actor's own active position (from
`req.capabilities`, their PERSONAL `users` login — an HOD inviting a
Class Tutor acts from their ordinary login, not a Position Account
session) must itself cover the target scope. `inviteToPosition`
idempotently provisions the target position if needed (generalizing
`ensureHodPosition`'s pattern, and setting `position_type='class_tutor'`
for the class case), creates the invitation, emails via new
`sendPositionAccountInvitationEmail`. `acceptInvitation` branches
insert-vs-update on `position_accounts` (a placeholder row may already
exist from provisioning), creates the occupant link, marks accepted.

**Uniform reassignment**: one `reassignPositionOccupant(client,
{positionAccountId, newOccupantUserId, actorUserId})` across L1/L2/L3
and the Class Tutor assignment — revoke sessions, bump token_version,
clear MFA/recovery, issue a fresh invite (per decision 9), swap the
occupant link. One DB transaction, all-or-nothing.

**Class Tutor-specific**: `assignClassTutor`/`reassignClassTutor` (new
file `classTutorService.js` if `academicService.js` is already large,
else a new section within it) — supersedes `updateClass`'s implicit
`tutorUserId` mutation; `ALLOWED_FIELDS` drops it once this ships.

## Migrating the 8 tutor-reading call sites — one swap each, same contract

Each site keeps its exact existing error type/HTTP status; only the
lookup mechanism changes:

1. `academicService.sendClassAlert` and 3. `attendanceService.assertCanMark`
   and 5. `examinationService.assertIsTutor` and 6. `financeService.
   recordScholarshipDecision`: `cls.tutor_user_id === actorUserId` →
   `(await identityService.resolvePositionOccupant(client, {collegeId,
   classId})) === actorUserId`. Requires a new `{classId}` overload on
   `resolvePositionOccupant`/`positionSlotResolver` (mirrors the
   existing `{departmentId}` overload).
2. `academicService.createClass`/`updateClass`'s error mapping moves
   into `assignClassTutor`/`reassignClassTutor`, now catching
   `position_class_assignments`' unique/FK violations instead —
   same `ClassTutorConflictError`(409)/`ClassTutorNotFoundError`(404).
4. `attendanceService.requestAttendanceCorrection`'s approver chain:
   same swap, `null` (vacant seat) handled exactly as `tutor_user_id:
   null` is today.
7. `studentService.createStudent`/`assertCanModifyStudent`: the
   *reverse* direction (user→their class) needs a genuinely new
   `identityService.resolveActiveClassTutorPosition(client, {userId,
   collegeId})` — filters the user's active positions to
   `position_type==='class_tutor'`,
   resolves its mapped class. **Riskiest mechanical translation** —
   can't reuse `resolvePositionOccupant` unchanged.
8. `visibilityResolver.resolveAssignedClassIds`: same swap to
   `resolveActiveClassTutorPosition` — output shape (`assignedClassIds`)
   unchanged, only the internal mechanism. Highest-scrutiny site since
   it's a named `resolveCapabilities` internal consumer (ADR-022).
9. `workflowChainService`'s `'tutor'` chain-role resolution: same swap
   as items 1/3/5/6.
10. `classRepository.findByTutorUserId` deleted once every caller
    above is migrated (including `staffService.deactivateStaff`).
11. `routes/classes.js`: `PATCH /classes/:id` stops accepting
    `tutorUserId` (explicit 400 if sent, not a silent no-op).

## Route layer

- `POST /position-accounts/login`, `/refresh`, `/logout` — mirror
  `routes/auth.js`'s shapes exactly.
- `POST /positions/:positionId/invitations` — generic, level-gated via
  the recursive guard. Platform-Admin-side L1/L2 invites likely belong
  on the platform router (ADR-010 keeps that structurally separate) —
  confirm exact placement at implementation time.
- `POST /position-accounts/invitations/accept` — unauthenticated,
  mirrors `routes/invitations.js`'s tenant-resolved-from-token pattern.
- **New dedicated** `POST /classes/:id/tutor` (assign) /
  `PUT /classes/:id/tutor` (reassign) rather than folding into
  `PATCH /classes/:id` — different actor set (HOD-only,
  own-department) than the rest of `classes.update` (principal-only).
  New permission `'classes.assign_tutor': ['hod']`, service layer
  additionally enforces the own-department check.

## Test migration

One fixture helper, `seedClassTutorPosition(adminPool, {collegeId,
userId, classId})` added to `positionFixtures.js`, mirroring
`seedHodPosition` (positions + position_accounts + position_class_
assignments + position_occupants rows). Assertions against
`tutor_user_id` become assertions via a small test-only
`findActiveClassTutorUserId(adminPool, classId)` DB query (tests stay
independent of the app code they verify). Riskiest first:
`attendance-service.test.js` and `student-service.test.js` (most call
sites/scenarios) — tackle before the single-assertion files.

## Delivery ordering — 23 steps, 6 groups, one commit each

**(a) Position Account auth core, L1/2/3 — proves the pattern, no Class Tutor yet:**
1. Migration A (add `position_type` column) + Migration E (refresh tokens table).
2. `positionRepository.js` additions + tests.
3. `positionAccountAuthService.js` (login/refresh/revoke) + tests.
4. `resolveCapabilitiesForPosition` + tests (not wired to middleware yet).
5. Wire `identity.js`/`sessionRevocation.js` type branches + integration
   test proving office-only scoping even when the same person also
   holds a personal login with different standing.
6. Migration C + `positionAccountInvitationRepository.js` +
   `positionAccountInvitationService.js`'s guard (levels 1/2/3 only) + tests.
7. Routes: login/refresh/logout + invite/accept for L1/2/3 + tests.

**(b) Class Tutor assignment schema + resolution extensions:**
8. Migration B (`position_class_assignments`) + repo additions +
   `classResolver.js` + tests.
9. `resolvePositionIdByClass` + `resolvePositionOccupant`'s `{classId}`
   overload + `resolveActiveClassTutorPosition` + tests (isolated, not
   consumed yet).
10. Extend the recursive guard to the Class Tutor assignment type +
    `ensureClassTutorPosition` (Level 4, `position_type='class_tutor'`) + tests.

**(c) Migrate the 8 call sites, small batches:**
11. `workflowChainService.js` + test.
12. `visibilityResolver.resolveAssignedClassIds` + test (do early — highest scrutiny).
13. `academicService.sendClassAlert` + test.
14. `examinationService.js` + `financeService.js` (bundle) + tests.
15. `attendanceService.js` (both sites) + both attendance test files (riskiest — most review time).
16. `studentService.js` (both sites) + test (second riskiest).
17. `staffService.deactivateStaff` call site + test.
18. `assignClassTutor`/`reassignClassTutor` + new routes +
    `academicService`'s `ALLOWED_FIELDS`/error-mapping move +
    `classes.test.js`/`academic-service.test.js` updates.
19. `seedClassTutorPosition` fixture + sweep any remaining raw
    `tutor_user_id` seeding onto it.

**(d) Drop the column:**
20. Migration D — only once `grep -rn tutor_user_id backend/src`
    returns nothing outside migration files and the full suite is green.

**(e) Reassignment lifecycle:**
21. `reassignPositionOccupant`, uniform across 1/2/3/5 + tests
    (session revocation, token-version bump, credential re-invite,
    MFA/recovery clear, atomic).
22. Wire `assignClassTutor`/`reassignClassTutor` through this shared
    function if step 18 didn't already.

**(f) Docs:**
23. Amend ADR-021 (Level 4 `position_type='class_tutor'` carve-out —
    hierarchy unchanged, assignment is orthogonal to level; §10's
    re-invite-not-temp-password amendment). Add a new ADR documenting
    `resolveCapabilitiesForPosition`
    as a second, non-unioned entry point (cross-references ADR-022,
    doesn't amend it). Update Identity-Architecture.md/BusinessRules.md.

## Definition of Done

- [ ] L1/L2/L3 and the Class Tutor assignment (Level 4,
      `position_type='class_tutor'`) each have a working
      invite→accept→login→refresh→logout cycle.
- [ ] `resolveCapabilitiesForPosition` proven (real integration test,
      one occupant holding two positions) to return only the queried
      position's own scope, never the other.
- [ ] Session revocation for a Position Account is independent of the
      same person's `users.token_version` state.
- [ ] Reassignment lifecycle identical across L1/L2/L3/Class-Tutor, one
      shared parametrized test suite (not four copies).
- [ ] `classes.tutor_user_id` fully removed; `grep -rn tutor_user_id
      backend/src` returns nothing outside migration files.
- [ ] All 12 named test files pass with the same *behavioral* contract
      (409/404/exact-actor-comparison/null-is-valid), only their
      seeding/assertion mechanism changed.
- [ ] HOD-only, own-department-scoped assignment is the sole path that
      sets a class's tutor, enforced at both route and service layers.
- [ ] `PATCH /classes/:id` no longer silently accepts `tutorUserId`.
- [ ] `resolveCapabilities`'s frozen ADR-022 shape is untouched.
- [ ] Full existing suite green at every step, not just at the end.
- [ ] MFA enrollment for Position Accounts explicitly out of scope,
      documented as a later-phase candidate.

## Explicitly deferred (not silently expanded)

- Position Account MFA enrollment (decision 8).
- Route/UI exposure for invitation resend/revoke (repo-layer support
  built now; routes deferred unless requested).
- Level 2's scope-configuration mechanism itself is unchanged — this
  phase only adds login on top of the existing
  `position_department_assignments` configuration.
- Exact router placement for Platform-Admin-side L1/L2 invites
  (platform router vs. tenant router) — a real decision to make at
  implementation time, not guessed here.
- A cache layer for `resolveCapabilitiesForPosition` (ADR-022 defers
  the equivalent for `resolveCapabilities` too — same treatment).

## Verification

`npm test` in `backend/` after every step. End-to-end proof for the
office-scoping DoD item: seed one person as both an HOD and (separately)
a Class Tutor, log into each Position Account, assert
`req.capabilities` differs and each is scoped correctly — the concrete
test that proves decision 4 actually holds, not just asserted in a
comment.
