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

## Attendance
- Attendance is marked hour-wise, within a defined attendance window.
- Attendance cannot be modified after it is locked.
- Only the staff member scheduled for that period, the class tutor,
  or an HOD (force-mark) may mark attendance for a given hour.
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
- Class Tutor is assigned only by HOD, for one class at a time;
  credentials for the Class Profile are sent automatically once
  assigned.
- **Resolved (Module 2 kickoff)** — Class Tutor: an assignment on a
  Faculty member, not a separate role. `users.role` does not gain a
  `class_tutor` value; a class/section record carries a tutor
  reference (a faculty user_id) instead. A faculty member's `role`
  stays `staff` regardless of whether they currently hold a tutor
  assignment — "role" means job title, tutor-of-a-class is a
  duty layered on top of it, checked via the assignment, not via
  `requireRole`. Matches the registration chains below unchanged:
  "Class Tutor is assigned only by HOD" is an assignment action, not
  a role grant.
- **Resolved (Module 2 kickoff)** — College Admin: a real, new
  tenant-level role (`users.role = 'college_admin'`), distinct from
  Principal, but narrowly scoped to two things: (1) bulk-provisioning
  user accounts during a college's *initial onboarding* onto ARCNAVE
  — an already-running college can have 100+ existing faculty on day
  one, and requiring Principal to individually approve each one
  through the normal registration chain isn't realistic at that
  volume; (2) uploading/managing college document templates
  (`DocumentService`-owned, per the Documents/Reports rule above).
  College Admin does **not** replace or share Principal's approval
  authority in the steady-state Staff/HOD registration chains below —
  those are unchanged for anyone joining after initial onboarding.
  College Admin is an onboarding/operational role, not a second apex
  role competing with Principal. (Open follow-up, not blocking: the
  actual bulk-provisioning mechanism — one-by-one repeated calls vs.
  a real CSV/bulk-import capability — is a Module 2 build decision,
  not a role-definition one; resolve it when that slice is built, not
  here.)

## Finance
- Fee changes require approval before taking effect.
- Students below a configured income threshold become scholarship
  eligible (exact threshold is per-tenant config, not hardcoded).

## Documents / Reports
- Reports are always generated from a `ReportModel` — no service
  other than the Generator Module produces file bytes, and the
  Generator Module never touches the database or storage directly.
- `DocumentService` is the sole owner of every file in the system —
  uploads, generated exports, templates. No other service writes to
  Storage directly, including AI tools.

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

## Multi-tenancy
- Every tenant-scoped query is protected by PostgreSQL Row-Level
  Security, not application-level filtering alone.
- Super Admin / Platform operations never execute inside the
  RLS-scoped tenant path — they run through a completely separate
  Platform API with its own auth, by design (Super Admin is not "a
  role" inside the tenant RBAC model).
