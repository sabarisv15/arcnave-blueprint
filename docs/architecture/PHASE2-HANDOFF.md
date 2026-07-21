# Phase 2 Handoff / Continuation Notes

Self-contained handoff so a new session (new account) can pick this up
without re-deriving anything. Paste this whole file's contents, or
point Claude at this path, at the start of the new session and say
"continue Phase 2 from here."

Branch: `business-rules-tasks-1-21`. Backend: `ARCNAVE-Blueprint/backend`.

---

## 1. What's actually done (committed, working)

**Phase 1 — Capability Resolver integration — SHIPPED.** 8 commits,
`35092a2`..`231a5cc`, full backend suite green (1176 tests). Made
`identityService.resolveCapabilities(client, {userId, collegeId})` the
single runtime identity façade (ADR-022, frozen contract) for:
- Authorization (`middleware/rbac.js`'s `requirePermission`)
- Workflow routing (`workflowChainService.resolveRoleUserId` via
  `identityService.resolvePositionOccupant`)
- Visibility/data-scope (`actorContextService.buildActorContext`)
- Audit logging (Position context on every `audit_log` row)

Also shipped: automatic HOD/Acting-HOD Position provisioning
(`staffService.ensureHodPosition`/`swapHodOccupant`), Level 2
visibility as a configurable-with-staff-fallback policy.

**Docs — committed at `a0fdf4c`.** `docs/architecture/Identity-Architecture.md`
(new), `Architecture.md` + `BusinessRules.md` (updated) — describes the
Position/Position-Account/Occupant model (ADR-021) that Phase 1
implements at runtime.

**`users.role` is STILL the live authentication mechanism today.**
Position Account login (this Phase 2) has not been built. Nobody can
log into a `position_accounts` row — `password_hash`/`token_version`
columns exist (migration `1756900000000_position-schema.js`) but
nothing reads or writes them.

## 2. What's NOT done — Phase 2, planning only, nothing implemented

`docs/architecture/Phase2-Position-Account-Auth-Plan.md` (uncommitted,
same folder as this file) has been **fully revised and is now current**
— it incorporates both corrections below (office-scoped authorization,
Class Tutor as a full Position replacement). It's a complete,
23-step, 6-group delivery plan with a Definition of Done. Nothing in it
has been implemented yet — read it in full before writing any code, and
get the user's explicit go-ahead on it first (they wanted to review
before Step 1 even for the first draft).

### 2a. The core mental model (get this exactly right — user's own words)

> "Principal duties, HOD duties never change, even after 5 years...
> they are administrators... person may change... but duties are
> same. So using person here makes no sense."

**Office = permanent seat with fixed duties. Person = temporary
occupant.** Principal, HOD-CSE, and "ECE 2nd Year" (a class/section)
are all the *same kind of thing*: a fixed-duty seat that someone
currently occupies. The seat has its own login. The occupant changes;
the seat and its powers never do.

- HOD creates a class's account and assigns/reassigns which staff
  member currently tutors it (once a semester). That staff member logs
  in **as the class**, not as themselves, to act on it (mark
  attendance, etc.) for that class specifically.
- Same pattern already exists for Principal (Level 1) and HOD (Level
  3) via `positions`/`position_accounts`/`position_occupants` — Class
  Tutor needs the same treatment, currently doesn't have it at all
  (`classes.tutor_user_id` today is just a bare FK straight to a
  person, no separate account/login).

### 2b. Two corrections to the original plan — BOTH RESOLVED, DESIGNED, IN THE PLAN

**(i) Authorization must scope to the specific office, not the person
broadly — RESOLVED.** Formalized as two named, never-blended identity
contexts:
- **Personal Identity Context** (Phase 1, shipped) — the authenticated
  individual; capabilities are the union of every responsibility they
  currently hold (`resolveCapabilities(userId)`). For personal
  workspace/operations.
- **Institutional Identity Context** (Phase 2, planned) — a single
  institutional account; capabilities resolve exclusively for that
  account, never merged with anything else the occupant holds
  (`resolveCapabilitiesForPosition(positionAccountId)`, new, sits
  alongside the frozen `resolveCapabilities`, never modifies it). For
  acting on behalf of a specific institutional entity.

The Position Account JWT's `sub` claim is the `position_account_id`
itself, not a `userId` — structurally impossible to union against
anything else the occupant holds. Fully designed in
`Phase2-Position-Account-Auth-Plan.md`.

**(ii) Class Tutor is IN SCOPE, and is Level 4 + `position_type`, NOT a
new level — RESOLVED (this took two passes to get right).** First pass
of the plan modeled Class Tutor as a new "Level 5" — this was WRONG and
was corrected after review: `positions.level` represents pure
organizational hierarchy (1 Principal, 2 institution-configured, 3
HOD, 4 Staff); Class Tutor (like future Placement Coordinator/NSS
Coordinator/Library In-charge/Exam Cell) is an **assignment** a Level 4
Staff position carries, not a separate rung. Corrected model: `positions.
level` CHECK stays `1-4` unchanged; a new nullable `position_type`
column on `positions` (e.g. `'class_tutor'`) distinguishes an
assignment-bearing Level 4 position from plain staff (still zero
Position rows, unchanged). A new `position_class_assignments` table
mirrors `position_department_assignments`, FK'd to `classes(id)`.
ADR-021's "Level 4 is person-centric, no Position ever created" gets a
narrow, explicit carve-out for this case only.
**If you see "Level 5" anywhere referring to Class Tutor, it's stale —
the correct, final answer is Level 4 + `position_type='class_tutor'`.**

## 3. Research — DONE

The `classes.tutor_user_id` usage inventory is complete. Full findings
are folded into `Phase2-Position-Account-Auth-Plan.md`'s "Class
Tutor's exact current blast radius" table: 8 call sites across
`academicService.js`, `attendanceService.js`, `examinationService.js`,
`financeService.js`, `studentService.js`,
`identity/visibilityResolver.js`, `classRepository.js`, and
`workflowChainService.js`, plus 12 test files that pin the exact
current behavior (409 on unique conflict, 404 on FK violation, exact
`tutor_user_id === actorUserId` comparisons, `null`/no-tutor as a valid
state). Confirmed: no dedicated `assignClassTutor` function exists
anywhere — tutor assignment is just a field on generic
`updateClass`/`createClass`.

## 4. What the next session should do, in order

1. **Read `docs/architecture/Phase2-Position-Account-Auth-Plan.md` in
   full** — it's the current, complete, 23-step/6-group plan covering
   both halves (Position Account login for L1/L2/L3, and Class Tutor's
   full replacement as Level 4 + `position_type='class_tutor'`). It
   already incorporates the two corrections in §2b below.
2. Get explicit user sign-off on it (written plan + Definition of Done,
   per their stated preference — see §5) **before writing any code**.
   Nothing has been implemented yet; there's no partial code to worry
   about breaking.
3. Once approved, execute Group (a) first (steps 1-7: Position Account
   auth core for L1/L2/L3 — smallest blast radius, proves the pattern
   before touching Class Tutor at all). One commit per step, per the
   user's standing preference.

## 5. Workflow preferences for this user (apply throughout)

- **Plan before code, DoD before "go."** Wants a written plan file and
  an explicit Definition of Done checklist locked in before any code
  is written — not just a verbal "sounds good."
- **Non-technical mode when asked**: use concrete, relatable analogies
  (ID badges, receptionists, named UI examples) — pushes back hard on
  abstract architecture-speak. When the user corrects a design in
  short, blunt, example-driven language ("whats complicated for u
  here?"), the right move is to **restate their model back in their
  own simple terms to confirm understanding before touching any
  plan/code** — not to immediately start redesigning off a partial
  read.
- **One commit per step**: code → update tests → run suite → commit →
  next. Never one large commit for a multi-step phase.
- **Wants real architectural review, not agreement** — when asked to
  review completed work against docs/ADRs, actually re-trace call
  chains and verify, don't rubber-stamp.
- **Terminology**: this project is greenfield (no production data) —
  avoid "migration"/"cutover"/"legacy compatibility" framing; say what
  changes plainly instead.
- Silent/low-narration mode is available on request ("work silently,
  save tokens") but isn't the default — confirm before assuming it.

## 6. Key files to re-read at the start of the new session

- `docs/architecture/Identity-Architecture.md` — the target model doc
  (ADR-021), especially §5 (Position types/levels), §6-7 (identity/
  capability resolution), §8 (authentication), §10 (lifecycle), §11
  (session management).
- `docs/architecture/Phase2-Position-Account-Auth-Plan.md` — first-draft
  plan, correct on schema/repository/route/middleware mechanics for
  Principal/Level2/HOD, **stale on authorization-scoping and missing
  Class Tutor entirely** (§2b above).
- `backend/migrations/1756900000000_position-schema.js` — the
  Position/Position-Account/Occupant schema Phase 1 already built on.
- `backend/migrations/1752000000000_module-3-academic-schema.js` (line
  48-63) — `classes` table, the `tutor_user_id` column this phase needs
  to replace/wrap.
- `backend/src/services/identityService.js` — the frozen
  `resolveCapabilities`/`resolvePositionOccupant` façade (ADR-022) —
  read before designing the position-scoped resolution addition.
- `backend/src/services/staffService.js` (`ensureHodPosition`/
  `swapHodOccupant`, ~lines 277-322) — the closest existing analogue
  for how a Class Account's occupant-assignment flow should work.
