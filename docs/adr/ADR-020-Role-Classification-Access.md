# ADR-020: Role → data-classification access matrix (Policy Gate)

Status: **Proposed** — a working default the Module 9 first slice
needed to ship something real, not a settled rule. AI-Governance.md §4
says which classification a tool may access is "defined per-tool... not
assumed" — this ADR is that missing definition, flagged as open rather
than silently assumed, same pattern ADR-005 used for
`workflowService.js`'s self-approval rule (proposed during
implementation, revisited once real usage existed).

## Decision

`aiToolRegistry.js`'s Policy Gate checks a tool's `dataClassification`
against the acting user's role via a hardcoded matrix,
`ROLE_CLASSIFICATION_ACCESS`:

```js
const ROLE_CLASSIFICATION_ACCESS = {
  principal:     ['Internal', 'Confidential', 'Restricted'],
  college_admin: ['Internal', 'Confidential'],
  hod:           ['Internal', 'Confidential'],
  staff:         ['Internal'],
};
```

This is checked independently of `tool.allowedRoles` — a role being
permitted to *invoke* a tool at all does not imply that role is
permitted to receive whatever classification of data that tool
happens to return (AI-Governance.md §4's own distinction: "a tool with
broad Read (L1) access is not automatically entitled to Restricted
data just because it's L1 — action level and data classification are
two independent checks").

## Why these four values, for these four roles

- **`principal`**: every classification. BusinessRules.md's approval
  chains consistently resolve the Principal as the terminal authority
  (staff registration, fee-structure approval) — the one role assumed
  to already have full visibility into the college's own data today,
  human-facing, elsewhere in this codebase.
- **`college_admin`**: `Internal`/`Confidential`, not `Restricted`.
  BusinessRules.md's College Admin resolution (item 2) scopes this
  role narrowly — bulk-provisioning, college profile maintenance — and
  explicitly does *not* extend Principal's approval authority or
  financial/salary access. `Restricted` (fee details, staff salary)
  falls outside that scope.
- **`hod`**: `Internal`/`Confidential`, mirroring `college_admin` —
  a department head plausibly needs marks/parent-phone-level data for
  their own department, but nothing in BusinessRules.md names an HOD
  as an actor for fee/salary data.
- **`staff`**: `Internal` only. The most common, least-privileged
  login role; withholding `Confidential`/`Restricted` by default is
  the conservative choice when no rule says otherwise.

## Alternatives considered

- **No matrix — gate on `tool.allowedRoles` alone**: rejected.
  Collapses two independent questions (`can this role invoke this
  tool at all` vs. `can this role see this classification of data`)
  into one, reopening exactly the gap AI-Governance.md §4 calls out.
- **Wait for BusinessRules.md to define this before shipping any AI
  tool**: rejected for this slice. Roadmap.md's own reasoning for
  building Module 9 last — against real Business Service interfaces,
  not speculative ones — argues against inventing the matrix in the
  abstract even longer; a real `L1`/`Internal` tool (`get_college_profile`)
  needed *some* gate to ship at all, so a conservative, explicitly
  provisional default was chosen over blocking.

## Consequences

- Every future AI tool must declare a `dataClassification`, and every
  future login role added to this codebase must get an explicit entry
  here — an omitted role denies access to everything above `Internal`
  by default (`ROLE_CLASSIFICATION_ACCESS[actor.role] || []`), fail-
  closed rather than fail-open.
- This matrix has no BusinessRules.md backing today. It should be
  revisited — and either ratified into BusinessRules.md or replaced —
  once a real tool actually needs `Confidential`/`Restricted` access
  for a role wider than `principal`, and again alongside the R0-R5 risk
  ladder (Module-09-AI.md's own Known Gaps) when the first `L2`/`L3`
  tool is proposed, since risk-ladder scoping and classification
  scoping are related but not identical questions.
- **Update (Module 9, notification tools slice)**: `draft_notification`
  (`L2`) and `request_notification_send` (`L3`) are now real
  `Confidential` tools — `Confidential` is no longer only exercised by
  `ai-service.test.js`'s dummy fixtures. Both are scoped to
  `principal`/`college_admin`/`hod`, all three of which already had
  `Confidential` access under this matrix, so this is still not a
  `Restricted`-tier tool in production use, and still not a case where
  a role wider than `principal` needed `Confidential`/`Restricted` for
  the first time (`college_admin`/`hod` already had it, unexercised,
  before these two tools existed). That specific open question —
  ratifying this matrix once a role's access is genuinely tested by
  real production use, not just declared — remains open.
