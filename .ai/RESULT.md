# RESULT

## Files changed
- backend/migrations/1751800000000_module-1-marks-to-text.js (new)

## What changed, per file
- `1751800000000_module-1-marks-to-text.js`: `up` changes
  `mark_10th`/`mark_12th`/`mark_iti` from `NUMERIC` to `TEXT`
  (Postgres's default numeric-to-text cast, always lossless). `down`
  casts back to `NUMERIC` via `mark_10th::NUMERIC` etc., with an
  explicit comment that this direction fails outright once any row
  holds a non-numeric string like `"92%"` — stated as a documented
  limitation, not a silent trap. Schema-only: confirmed by reading
  `studentRepository.js` (its `COLUMNS` list) and `studentService.js`
  (its `ALLOWED_FIELDS` list) before writing anything — both already
  pass `mark10th`/`mark_10th` etc. through as opaque values with zero
  `NUMERIC`-specific handling (no `parseFloat`/`Number()`/type coercion
  anywhere near these fields), so neither file needed a single change.
  No other column, table, or file touched.

## Tests
Ran against a throwaway `postgres:16` container, roles created
matching `docker/postgres/init/`. To control the exact sequence (seed
data *before* this migration, prove the fix *after*), the new
migration file was held out of `migrations/` while running the first
three migrations, then moved back in for its own `up`/`down`. Container
removed after.

1. **Pre-existing data survives `up`, losslessly** — with only the
   first three migrations applied (`mark_10th` still `NUMERIC`), seeded
   a real college + a student row with ordinary numeric marks
   (`mark_10th=85.5`, `mark_12th=90`, `mark_iti=NULL`). Ran `up`:
   succeeded; `pg_typeof(mark_10th)` confirmed `text`, and the values
   round-tripped exactly (`"85.5"`, `"90"`, `NULL`) — no precision
   loss, no reformatting.
2. **The actual bug is fixed, proven via a real API call** — with `up`
   applied, logged in as a real seeded `principal` user against the
   real Express backend and called `POST /api/v1/students` with the
   exact case that used to 500: `mark_10th: "94.2%"`, plus
   `mark_12th: "89.6%"` and `mark_iti: "460/500"` (both input
   conventions the modal's placeholder text offers). Result: **201**,
   not 500, all three values stored and returned exactly as sent.
3. **`down` behaves exactly as documented — fails predictably once
   non-numeric data exists.** With the `"94.2%"` row still present,
   ran `down`: failed with Postgres `22P02` (`invalid input syntax for
   type numeric`), inside `mark_10th::NUMERIC`. Confirmed this was a
   clean, transactional failure, not a half-applied migration —
   `pgmigrations` still listed the migration as applied and
   `pg_typeof(mark_10th)` was still `text` afterward, both unchanged.
4. **`down` runs cleanly against ordinary data** — deleted the
   `"94.2%"` row (only that row), re-ran `down`: succeeded. Confirmed
   the original seeded row round-tripped back to `NUMERIC` with the
   exact original values (`85.5`, `90`, `NULL`) — a genuine clean
   up/down cycle against real pre-existing data, per the acceptance
   criteria.
5. Re-applied `up` as the final state, then ran the full backend suite
   (`node --test tests/`) against this same database — **106/106
   pass**, no regressions from any prior slice.
6. Confirmed via `git status --short` that
   `studentRepository.js`/`studentService.js` have zero diff, and no
   file other than the one new migration changed.

## Flags / open questions
- **`down` is a real escape hatch, not a guaranteed-safe rollback,
  once genuine free-text mark data exists** — demonstrated directly
  above (Tests #3), not just asserted in a comment. Anyone rolling
  back this migration in an environment with live `"%"`- or
  `"/"`-style data needs to either clean those rows first or accept
  that `down` will fail loudly (it does fail loudly — a `22P02`, not a
  silent truncation or corruption) rather than quietly succeeding.
- **The underlying "what does `mark_10th` actually mean" question is
  still open, on purpose** — this fix deliberately did not decide
  whether `"92%"` means the number 92, 0.92, or something else; `TEXT`
  just stores what a user typed. Per the task's own reasoning, that's
  for a future Reports/Analytics-era slice to decide with a real
  business rule, not something resolved here.
- **No code changes were needed in `studentRepository.js` or
  `studentService.js`, confirmed rather than assumed** — read both
  files before writing the migration; neither has any type-specific
  handling for these three columns, so this really is schema-only, as
  scoped.
