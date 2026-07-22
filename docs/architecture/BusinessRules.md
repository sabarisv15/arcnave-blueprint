# ARCNAVE — Business Rules

This is the single reference for domain rules. When code and this
document disagree, this document is correct until deliberately
updated — not the other way around. Add to this file the moment a
new rule is decided, in the module that owns it.

## Academic / Timetable
- A class's attendance cannot be marked until its timetable status is
  `Approved`. Attendance depends on Academic; Academic never depends
  on Attendance (one-way dependency, drives module build order).
- Academic owns: academic year, semester, subjects, curriculum,
  faculty allocation, timetable, calendar.
- **Timetable revision**: an approved timetable is immutable. Any
  permanent academic change is recorded as a new, numbered, dated
  revision — never an edit to the approved one. Only one revision may
  be effective for a given timetable scope at a time; attendance
  always uses the revision effective on the class date. Substitute
  faculty, room changes, and emergency adjustments are temporary
  operational overrides and never create a timetable revision. All
  revisions are permanently retained.
- **Substitute teacher provision**: when the assigned faculty member
  is unavailable, an authorized academic authority (HOD or equivalent)
  may temporarily assign another qualified faculty member to conduct
  the scheduled class. The assignment is session-scoped only (expires
  automatically after the assigned period), does not alter the
  official timetable, grants only the minimum permissions needed for
  that session, and is fully audited (assigned faculty, substitute,
  period, reason, assigning authority).
- **Academic Year**: an institution operates under exactly one Active
  Academic Year at a time (lifecycle: Draft → Active → Closed →
  Archived). Every attendance, timetable, examination, mark, fee, and
  report record belongs to an Academic Year. The previous year must be
  Closed before a new one becomes Active. Only the Principal may
  request lifecycle transitions (create/activate/close/archive); see
  Multi-tenancy for how College Admin executes the configuration
  change on the Principal's approved request. AI defaults to the
  Active Academic Year unless another year is explicitly requested,
  and never changes the lifecycle itself.
- **Curriculum / regulation versioning**: multiple curriculum
  ("regulation") versions may coexist. A student's regulation is fixed
  at admission and stays fixed except through an official Curriculum
  Migration workflow. Each regulation owns its own subject list,
  credits, contact hours, and examination scheme; historical
  regulation versions never change. Official syllabus documents are
  uploaded and retained as the source reference; AI may extract
  subject code/name/semester/credits/hours from them, but extracted
  data always requires human verification before it is published into
  the ERP — AI never publishes curriculum data unilaterally. HOD
  assigns approved subjects to faculty for a specific Academic
  Year/semester.
- **Automatic timetable generation**: after faculty are assigned to
  subjects, AI generates a balanced, conflict-free timetable one
  class/department at a time (never institution-wide in one pass),
  using each faculty member's Permanent Internal Staff ID to check
  availability against *all* already-approved timetable allocations
  across the institution — a faculty member already locked into
  another department's approved timetable cannot be double-booked. HOD
  reviews and approves the generated timetable; once approved it is
  read-only and other departments cannot override it. If no
  conflict-free timetable is possible, AI reports the conflict for HOD
  action rather than guessing. Permanent changes go through the
  Timetable revision rule above.

## Attendance
- Attendance is marked hour-wise, within a defined attendance window
  (session start to 30 minutes after).
- **Correction, not immutability**: before lock, Subject Faculty and
  the active Class Tutor may edit attendance for their assigned class
  freely, no approval needed (every edit is still audited). After
  lock, Subject Faculty submits a correction request; Class Tutor
  approves routine corrections; high-risk corrections follow the
  institution's configured approval workflow (see Configurable
  Approval Workflow). The original recorded value is never deleted —
  an approved correction becomes the new *effective* value, and all
  dependent calculations (percentages, shortage checks, reports,
  dashboards, alerts) are recalculated from it. AI always reports the
  latest effective value while preserving the original for authorized
  audit views, and never edits attendance directly outside this
  workflow.
- Only the staff member scheduled for that period, the class tutor,
  an HOD (force-mark), or an authorized substitute faculty member (see
  Academic / Timetable) may mark attendance for a given hour.
- **AI attendance assistant**: faculty may mark attendance with a
  natural-language message during the attendance window (e.g. "mark
  roll numbers 35, 67, and 25 absent"). AI identifies the current
  session from the approved timetable, validates the sender is the
  assigned or substitute faculty via their Permanent Internal Staff
  ID, marks the named roll numbers Absent and everyone else enrolled
  Present, and records full audit detail. Duplicate marking,
  cancelled-class marking, marking without an approved timetable, and
  marking outside the window are all rejected.
- **No separate leave module**: ARCNAVE does not provide a student/
  parent leave-request or approval workflow. Attendance is derived
  solely from recorded per-period attendance; a student absent for
  every scheduled period of a working day is logically a full-day
  absence. If a student is absent for more than five consecutive
  working days, the system automatically notifies the Class Tutor and
  HOD for review. Medical certificates or leave letters, where an
  institution requires them, are handled outside the ERP — AI never
  infers an "approved leave" state that overrides recorded attendance.
- "Final year" is not a structured field today — only free-text class
  names and semester 1–4 result fields exist. Any rule or AI tool
  that filters on "final year" is a soft text match, not a guaranteed
  structured filter, until a dedicated field is added.

## Students
- Student register number is unique within a tenant.
- Business identity for dedup/import purposes is Register Number,
  EMIS Number, or Admission Number — **never Aadhaar**. Aadhaar is
  never part of identity, dedup, import, search, AI reasoning, or
  reporting. If a college requires it for a government process, it
  is stored as an optional, encrypted, access-restricted field only
  — never a normal identity attribute. This is a compliance
  requirement (Aadhaar Act), not an architectural preference.
- **Known, deliberate deviation from source spec**: the original
  requirements documents (`ARCNAVE WEBSITE INSTRUCTIONS.txt`,
  `ARCNAVE_ANTIGRAVITY_REQUIREMENTS.txt`) list Aadhaar as a
  *required* student field and explicitly instruct "do not remove
  profile fields." This rule is intentionally overridden here for
  compliance reasons — do not "fix" this by re-adding Aadhaar as
  required to match the source spec. If a future business need
  requires collecting it, revisit as an optional, Restricted field
  only, with legal sign-off, not by matching the spec as written.
- **Student transfer**: a student keeps a single Permanent Student ID
  for life. Internal department/course transfers update the student's
  academic context while preserving enrollment continuity. Inter-
  college transfers create a *new* enrollment linked to the same
  Permanent Student ID — never a new student. All historical academic,
  attendance, financial, administrative, and document records stay
  attached to the context in which they were created; transfers follow
  the institution's configured approval workflow and are permanently
  audited. AI identifies students by Permanent Student ID, distinguishes
  active from historical enrollments, and never merges or rewrites
  historical records across a transfer.
- **Student lifecycle**: Applied → Admitted → Active → (Suspended /
  Discontinued / Debarred / Dismissed) → Graduated → Alumni →
  Archived. Lifecycle status is independent of attendance status —
  attendance drives absence monitoring and alerts, lifecycle drives
  eligibility for institutional processes. Discontinued, Debarred, and
  Dismissed block automatic semester progression until changed through
  the institution's configured approval workflow. Class Tutor may
  update a student's status with a mandatory reason, subject to that
  same configured workflow for high-severity transitions
  (Debarred/Dismissed) — this is not a unilateral Tutor action for
  those statuses. Every status change is permanently audited (previous
  status, new status, effective date, updated by, reason). AI never
  classifies a student as Discontinued, Debarred, or Dismissed without
  an approved institutional record behind it.
- **Semester progression and graduation**: promotion to the next
  semester happens automatically when the current semester is
  officially closed, for any student whose lifecycle status doesn't
  block it (arrears alone do not block progression unless university
  regulations say otherwise; Suspended is promoted or blocked per
  institution policy). Graduation is assigned once final-semester
  results are published and no arrears/disciplinary hold remain, with
  Principal approval where the institution requires it. Alumni status
  is automatic the moment graduation is approved. AI evaluates
  progression eligibility from lifecycle status, generates an
  exception report for students not promoted (with reason), and never
  decides graduation itself.
- **Student documents**: student-facing documents (not staff/HR) are
  kept in a flat, searchable per-student repository — no folder
  hierarchy. Only the current version of each document is retained;
  replacing a document updates the current copy, with upload/
  replacement metadata and audit. This reuses `DocumentService` as the
  sole storage owner (see Documents / Reports) — it is not a second
  storage path.
- **No parent portal**: ARCNAVE does not provide parent accounts,
  logins, or a parent dashboard. Attendance, marks, documents, and
  notices are accessed only by authorized institutional users (and the
  student, where a student portal is enabled). Parent communication,
  where required, happens outside the ERP through institutional
  procedure. AI never treats a parent as a system user and never
  exposes student information outside role-based access control.

## Staff
- Only the class tutor may edit a student profile under normal
  workflow rules (specific exceptions — e.g. HOD override — are
  handled through WorkflowService, not by loosening this default).
- Any faculty member assigned to a class via the timetable may VIEW
  that class profile; only the assigned class tutor may EDIT it.
- Staff registration chain: Faculty submits a profile request → HOD
  of the department named in the request approves → Principal gives
  final approval → Staff ID is generated automatically → credentials
  are emailed → login is enabled only once credentials exist.
- HOD registration chain: HOD submits a profile request → Principal
  approves → credentials generated.
- Class Tutor is assigned only by HOD, for one class at a time, scoped
  to the HOD's own department; credentials for the Class Tutor Position
  Account are sent automatically once assigned (an invite, not a
  mailed password — see the Institutional identity model rule below).
- **Resolved (Phase 2)** — Class Tutor is a real Institutional Position
  Account, not a bare FK on `classes` and not a separate `users.role`
  value either. `users.role` still does not gain a `class_tutor`
  value — "role" means job title, and a faculty member's `role` stays
  `staff` regardless of whether they currently hold a tutor assignment.
  What changed from the earlier design: instead of `classes` carrying a
  plain `tutor_user_id` FK, a Class Tutor assignment is a Level 4
  Position (`positions.position_type = 'class_tutor'`, `positions.level`
  unchanged at 4 — not a new level) following the identical
  Position/Account/Occupant model HOD already uses one level up, linked
  to its class via `position_class_assignments`. `classes.tutor_user_id`
  has been fully removed. "Class Tutor is assigned only by HOD" is
  still an assignment action, not a role grant — enforced via
  `POST`/`PUT /classes/:id/tutor` (permission `classes.assign_tutor`,
  HOD-only, own-department-scoped), not via `requireRole` and not via
  `PATCH /classes/:id` (which now explicitly rejects `tutorUserId`
  rather than silently accepting it). See
  `docs/architecture/Identity-Architecture.md` §5.2 and
  [[ADR-021-Institutional-Position-Account-Model]]'s Amendments section
  for the full model.
- **Staff lifecycle**: every staff member has a Permanent Internal ID
  for their whole institutional lifecycle; the institution-issued
  Staff ID/Employee Code may change on reappointment, but historical
  records always reference the Permanent Internal ID. Faculty
  deactivation is performed by HOD; HOD deactivation is performed by
  Principal. Staff accounts are deactivated, never deleted, and
  historical academic/administrative records are unaffected. Before
  deactivation, the responsible authority reassigns the outgoing
  staff member's subject allocations, timetable assignments, and
  responsibilities — historical actions stay attributed to the
  original staff member regardless. If a permanent HOD is unavailable,
  Principal may appoint an eligible faculty member as temporary HOD
  In-Charge (appointment and revocation are permanently audited). A
  staff member may hold multiple institutional roles/duties
  simultaneously; existing duties continue unless explicitly
  reassigned.
- **Institutional identity model (Position Accounts)**: for Level 1,
  Level 2, and Level 3 positions, and for the Class Tutor assignment
  (Level 4 + `position_type='class_tutor'`), the permanent identity is
  the Institutional Position Account, not the person — one account per
  position, created once, never deleted (ADR-021). Occupant
  reassignment (e.g. a new Principal appointed, or a class's tutor
  changed) is a single atomic operation, uniform across all four:
  revoke all active sessions, invalidate every refresh token, increment
  `token_version`, reset credentials via a fresh invite (not a mailed
  temporary password — ADR-021's Amendments), and clear MFA enrollment;
  official email/mailbox, resolved permissions, and audit history carry
  over unchanged. Level 1 accounts are provisioned automatically and
  unconditionally when a college's Principal invitation is accepted —
  standing behavior, not a rollout flag. Level 2 positions are
  Principal-configured per institution; Class Tutor positions are
  HOD-provisioned, own-department-scoped, on first assignment; plain
  Level 4 staff (no assignment) stay person-centric and outside this
  account model entirely. **Current state (Phase 2 shipped)**:
  Position Account login/refresh/logout and invite-based credential
  bootstrap are live for all four — a person may hold both a personal
  login and, separately, credentials for an office they occupy, and the
  two never resolve capabilities into one union (see
  `docs/architecture/Identity-Architecture.md` §6 for the two identity
  contexts and [[ADR-023-Institutional-Capability-Resolver]] for the
  resolution contract).
- **Session revocation** (ADR-024): every authenticated request
  re-validates `token_version` against the database, unconditionally.
  Password reset, MFA reset, or a Position Account occupant change all
  bump `token_version` and revoke outstanding refresh tokens
  immediately — no partial-revocation window.
- **Resolved (College Admin — final model)** — College Admin is an
  **ARCNAVE support employee, not a college employee, and not part of
  the institution's academic hierarchy** (Faculty / HOD / Principal).
  College Admin does not teach, does not make academic decisions, and
  never approves an academic workflow on the institution's behalf.
  Responsibilities: institution onboarding, initial system
  configuration, college profile setup, workflow configuration,
  Academic Year configuration, and other product-level administration
  — always performed *at the institution's request*, never on College
  Admin's own initiative. This replaces the earlier "College Admin as
  a tenant `users.role` value" design — there is no `college_admin` row
  in any tenant's `users` table. See Multi-tenancy for the access
  model (request → approval → logged access → change → audit) and how
  this fits alongside Super Admin as the two platform-side actors that
  sit outside every tenant's RBAC.

## Finance
- Fee changes (fee amount/schedule, `fee_structures`) require Principal
  approval before taking effect — unchanged, already implemented via
  `financeService.submitFeeStructureApproval`/`approveFeeStructure`
  routed through WorkflowService.
- Marking a student's fee line Paid/Not Paid (`fee_payments`), with an
  optional receipt document attached, is a direct write with no
  approval gate — a manual student-profile action, not a "fee change."
  This is purely a simplified academic-view status on top of the
  existing `fee_structures` finance workflow, which is unchanged.
  **Resolved**: only two statuses, Paid/Not Paid — no Partial status.
  `fee_payments.status` (`paid`/`not_paid` in code) already matches
  this exactly; no schema change needed. ARCNAVE does not provide
  payment-gateway, ledger/accounting, fine calculation, concession-
  processing, or refund capability; those stay outside ARCNAVE's scope
  (see Documents/Reports skipped-modules note).
- **Scholarship eligibility (superseded)** — ARCNAVE does not enforce
  hardcoded eligibility criteria (income, community, merit, disability,
  attendance, or otherwise). Each institution defines its own
  scholarship schemes; the Class Tutor reviews students and marks each
  one Eligible or Not Eligible per the institution's own policy, with
  every decision audited. AI never decides or sets eligibility — it may
  only surface advisory signals (attendance summary, academic
  performance, prior scholarships, and where configured, an
  income-threshold hint) to help the Tutor decide. The previously
  built `financeService.checkScholarshipEligibility` (a hardcoded
  income-threshold check) is retained only as one such advisory input,
  not as the eligibility outcome itself — do not treat its return
  value as a final decision anywhere in the product.

## Documents / Reports
- Reports are always generated from a `ReportModel` — no service
  other than the Generator Module produces file bytes, and the
  Generator Module never touches the database or storage directly.
- `DocumentService` is the sole owner of every file in the system —
  uploads, generated exports, templates. No other service writes to
  Storage directly, including AI tools.
- **Examination management**: no separate Exam Cell module. Each class
  has a generic Examination section, owned by that class's Tutor, for
  official (University/DOTE) examination timetables and related
  documents — PDF-first uploads, versioned. AI extracts relevant
  timetable data from an uploaded PDF and diffs it against the prior
  version; the Tutor verifies and publishes the revision *without*
  requiring HOD or Principal approval (an institution-level choice,
  not a gap). Affected students/faculty are alerted only when a
  revision has a meaningful change — a re-upload with no real change
  sends no alert. AI never assumes document types or invents exam
  policy.
- **Assessment marks**: the assigned Subject Faculty records raw
  assessment marks for their subject against institution-configured
  assessment types; the system stores marks exactly as entered — no
  automatic grade, best-of, or weightage calculation. Marks export to
  CSV using the same filters (Academic Year/Department/Class/Subject/
  Assessment) used for entry; every mark change is audited. AI may
  flag missing marks or likely data-entry errors, but never calculates,
  edits, or exports marks itself.
- **Explicitly out of scope (not an oversight)**:
  - *Hall Ticket / exam eligibility* — issued by University/DOTE or the
    relevant external authority; ARCNAVE never generates, approves,
    blocks, or manages hall tickets. Related official documents may
    still be stored in a class's Examination section if the Tutor
    chooses.
  - *Full fee accounting* — payment gateway integration, receipt
    generation as a ledger, fine calculation, concession processing,
    and refund workflows are not part of ARCNAVE. Finance operations
    beyond the lightweight paid/not-paid status above (see Finance)
    are assumed to be handled by separate accounting systems or
    institutional procedure.

## Notifications
- Every outbound notification (email/SMS/WhatsApp) is a row in
  `notifications` before it is sent — draft → approved (records
  `approved_by`) → dispatched. `notification_delivery` records every
  attempt (provider, status, error, timestamps) so delivery history
  is never lost, including retries.
- Notifications that leave the system (reach a real phone/inbox)
  always require human approval before dispatch — see
  AI-Governance.md Level 3 (Act). This applies regardless of whether
  a human or the AI initiated the draft.
- Documented exception: **Send Alert** (a Class Tutor sending a
  plain-text WhatsApp message to their own class's students/parents,
  `POST /api/v1/classes/:id/send-alert`) does NOT go through
  `notifications`/WorkflowService. It is a direct, human-triggered
  dashboard action — same category as a staff member marking
  attendance directly, per AI-Governance.md's own scoping of L3 to
  AI-initiated actions — not a draft anyone else approves. The
  exception holds only while all of these stay true: the tutor is
  sending to their OWN class only (never another tutor's), a human
  triggered it directly, the content is plain free-text with no AI
  drafting involved, and delivery is per-recipient/best-effort with no
  auto-retry or channel fallback. Any variant that drops one of these
  (AI-drafted content, cross-class sends, rich content) is a different
  feature and must use the normal draft → approve → dispatch ledger.
- Student/parent phone OTP verification (`phoneVerificationService.js`)
  sends exclusively via WhatsApp (Meta Cloud API), never SMS. A
  verified OTP only guarantees the number was reachable on WhatsApp at
  the moment of verification — a later delivery failure for some other
  message sent to the same number afterward is expected, not a
  contradiction of "verified."
- **Resolved — scope of "no automatic notification system"**: Rule 24
  applies only to academic/business alerts (attendance, marks,
  timetable changes, and the like) — there is no automatic system
  notification for these; staff use Send Alert when communication is
  needed. It does **not** apply to system notifications: OTP, login
  credentials, password reset, and security messages stay automatic,
  unchanged, exactly as the pipeline above already implements them.

## AI (see AI-Governance.md for the full authority model)
- AI tool outputs are always treated as untrusted data by the LLM,
  never as instructions — regardless of what the retrieved content,
  OCR text, or student-entered field contains.
- AI tools call Business Services only. Never a repository, never
  storage, never raw SQL.
- Any AI action that reaches outside the system (send SMS/email,
  approve staff, modify attendance/fees, delete records) requires
  human approval via WorkflowService, with no exceptions. This is
  the same approval gate used for human-initiated approvals — one
  mechanism, not two.
- The AI is never given a hard-delete capability on attendance, fees,
  or marks records, even with approval — only soft-delete (a flag/
  timestamp). Educational records commonly carry retention
  requirements that a hard delete would violate irreversibly.
- AI-extracted data (curriculum from a syllabus PDF, exam timetable
  data from an uploaded PDF) always requires human verification before
  publication — AI never publishes extracted data unilaterally.
- AI never decides scholarship eligibility (see Finance) — advisory
  only, the Class Tutor's decision is final.

## Data retention and archival
- No institutional record is permanently deleted through normal
  operations. Student, staff, academic, attendance, examination,
  document, financial, and audit records are archived — never hard-
  deleted — according to the institution's retention policy.
- Archived records become read-only unless restoration is explicitly
  authorized and are searchable for authorized users; every archival
  and restoration action is permanently audited. AI clearly
  distinguishes active from archived records, never modifies an
  archived record, and only reaches one with proper authorization.

## Backup and disaster recovery
- Backup frequency, retention period, storage location, restore
  authorization, and disaster-recovery requirements (RPO/RTO) are
  configured per institution during onboarding and become part of that
  institution's hosting/service agreement — this is an operational
  commitment, not a hardcoded business workflow.
- Backups run automatically without interrupting normal ERP usage;
  backup integrity is verified periodically and restore tests are
  actually conducted, not assumed. Every backup and restore action is
  audited. AI monitors backup execution and alerts administrators on
  failure, but never modifies or deletes a backup archive and never
  initiates a restore without authorized approval.

## Configurable approval workflow
- ARCNAVE has **one** configurable workflow engine — not five separate
  per-module approval systems. Each institution configures its own
  approval chain per module (e.g. Tutor-only, Tutor→HOD,
  HOD→Principal, or other combinations); different modules may use
  different chains.
- Workflow changes apply only to new requests — a request already in
  flight continues under the workflow version that was active when it
  was created, not a version introduced mid-flight.
- Temporary delegation (start date, end date, reason, delegated
  approver) is supported; an HOD In-Charge appointment (see Staff
  lifecycle) automatically acts as a workflow delegate where
  applicable. AI routes requests using module, institution
  configuration, workflow version, and active delegation, and never
  skips a mandatory approval level.

## Platform role model and dashboards
- Three primary institutional roles: Faculty, HOD, Principal (plus any
  other staff roles an institution configures). Students never have a
  login or dashboard. Class Tutor remains an assignment layered on a
  Faculty member, not a separate role or a separate user (see Staff).
- College Admin is **not** part of this institutional hierarchy at
  all — it is an ARCNAVE-side support role with no seat in any
  tenant's role model; see Staff and Multi-tenancy.
- Dashboards are role-based and configurable per institution; AI
  personalizes dashboard content by active role and current
  assignments, and never assumes Tutor privileges outside an active
  assignment.

## Platform administration
- **Institution Settings** is the single per-tenant configuration area
  (institution profile, academic settings, user/role management,
  workflows, security, assessment, examination, calendar, AI,
  import/export, alerts). The onboarding wizard and the Institution
  Settings module share the same underlying configuration — onboarding
  pre-fills what Institution Settings later maintains. Every
  configuration change is audited. AI may explain settings and
  recommend configuration based on best practice, but never changes a
  setting without authorization.
  **Coverage audit (task #21)** — verified per sub-area, not a single
  screen: institution profile (`routes/collegeProfile.js`), academic
  settings (`routes/academicYears.js` + `routes/curriculum.js`),
  assessment (`routes/assessments.js`), examination
  (`routes/examination.js`), calendar (`routes/calendar.js`), workflows
  (`routes/workflowChains.js` + configurations category
  `workflow_chains`), AI (`routes/aiConfig.js` + configurations
  category `ai`), and security (MFA/session policy — configurations
  category `auth`) are all real, audited, principal-gated routes today.
  Three items are genuine, named gaps, not silently built here: (1)
  role management — role→permission mappings are a static code table
  (`middleware/permissions.js`), not tenant-configurable via any API,
  same scope-level-model gap the architecture refactor notes already
  flag as planned-not-started; (2) alerts — only an ad hoc Send Alert
  action exists (`academicService.sendClassAlert`), no configurable
  alert policy/threshold area; (3) import/export — deliberately
  per-module opt-in per this same rule's own wording ("each module
  decides whether import/export is supported"), proven on one real
  call site (`academicService.importTimetablePeriodsCsv`), not a
  missing generic screen. None of these three is invented or guessed
  at here — they stay open, explicit follow-ups.
- **Central audit log**: append-only, covers significant actions
  across every module (login/logout, student/staff/attendance/marks/
  document/settings/workflow/role changes) with timestamp, user,
  action, module, affected record, and result. Normal users cannot
  modify it. AI may summarize audit history but cannot alter entries.
- **Import/export**: a shared platform capability, not reimplemented
  per module. Each module opts in and decides which fields are
  importable/exportable; imports are validated before commit; exports
  return only data the requesting user is authorized to see. AI may
  assist with column mapping/validation but never auto-commits an
  import.
- **Authentication**: a user may hold multiple concurrent sessions
  across devices — logging in on one device does not terminate
  another session. MFA is configurable per institution (Disabled /
  Optional / Mandatory) and may be scoped to specific roles. AI
  operates only after successful authentication and can never bypass,
  disable, or weaken MFA.
- **Academic Calendar**: one shared institutional calendar (not a
  personal task list) for semester dates, holidays, exams, and other
  institution-defined events; no predefined event-type restriction.
  AI can answer calendar questions but never creates or edits an event
  without authorization.

## Multi-tenancy
- Every tenant-scoped query is protected by PostgreSQL Row-Level
  Security, not application-level filtering alone.
- Two actors sit entirely outside every tenant's RBAC model, by
  design — neither is "a role" inside any tenant's `users` table, and
  neither executes inside the RLS-scoped tenant path via ordinary
  tenant auth:
  - **Super Admin** — platform operations, through a completely
    separate Platform API with its own auth.
  - **College Admin** — an ARCNAVE support employee (see Staff),
    scoped per-request to a single institution. Access model: the
    institution raises a request *inside ARCNAVE* (not an external
    support ticket) → the request is approved inside ARCNAVE → College
    Admin's access to that specific tenant is logged (who, which
    college, when, why) *before* any change is made → the
    configuration change itself is performed → the change is recorded
    in the normal central audit log. The institution decides; College
    Admin only executes the institution's approved request — it never
    makes an academic or institutional decision, and it never
    substitutes for Principal's approval authority in the Staff/HOD
    registration chains.
