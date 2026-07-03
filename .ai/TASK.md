# TASK

## Objective
Module 1 (Student), follow-up fix: change `mark_10th`, `mark_12th`,
`mark_iti` from `NUMERIC` to `TEXT`. Found during the UI slice: the
modal's own placeholder text invites `"92%"` or `"460/500"`, neither
of which `NUMERIC` can store — a `%` value 500s at the DB layer
instead of a clean 400.

## Why TEXT, not parsing/validation
Considered and rejected: stripping `%` and parsing as a number. The
modal's placeholder explicitly offers *two* input conventions —
`"92%"` (a percentage) and `"460/500"` (a raw fraction) — and there
is no existing, decided business rule for which canonical numeric
meaning either should collapse to (92 vs 0.92 vs "store the fraction
as two numbers" are all defensible, none is documented anywhere).
Inventing that decision now, inside a small follow-up fix, would be a
bigger and riskier call than this slice should make. `TEXT` stores
exactly what a user actually enters, in either convention, losslessly
— matching CLAUDE.md's own "don't invent structure that wasn't
asked for" discipline. If a future module (Reports/Analytics) needs
to compute on these values, that's the point to make a real,
deliberate parsing decision — with an actual business rule behind it,
not a guess made to unblock a UI bug.

## Files likely affected
- `backend/migrations/1751800000000_module-1-marks-to-text.js` (new
  — next timestamp after `1751700000000_module-1-student-schema.js`)

## Exact changes
- `up`: `ALTER TABLE students ALTER COLUMN mark_10th TYPE TEXT`, same
  for `mark_12th` and `mark_iti`. No `USING` cast needed beyond
  Postgres's default numeric-to-text (lossless, always succeeds).
- `down`: `ALTER TABLE students ALTER COLUMN mark_10th TYPE NUMERIC
  USING mark_10th::NUMERIC`, same for the other two. Note in a
  comment that this direction can fail if any row by then contains a
  non-numeric string (e.g. `"92%"`) — acceptable for a `down`
  migration (they're an escape hatch for a bad deploy, not guaranteed
  lossless in the reverse direction once real free-text data exists),
  but say so explicitly rather than leaving it a silent trap.
- No code changes needed anywhere else: `studentRepository.js`'s
  `COLUMNS` list and `studentService.js`'s `ALLOWED_FIELDS` already
  pass these values through generically with no NUMERIC-specific
  handling (confirm this by reading both files before assuming it,
  not just trusting this task description) — the type change should
  be schema-only.

## Acceptance criteria
- Migration runs `up` and `down` cleanly against a DB that already
  has the Module 1 schema + some seed data, including at least one
  row with a `%`-style mark value (prove the bug is actually fixed,
  not just that the migration runs).
- After `up`: creating a student through the real API (or the modal's
  actual payload shape) with `mark_10th: "94.2%"` succeeds with a 201,
  not a 500.
- `studentRepository.js`/`studentService.js` require zero changes —
  if you find you need to change either, stop and flag why, don't
  just make the edit.
- No other column, table, or file touched.
