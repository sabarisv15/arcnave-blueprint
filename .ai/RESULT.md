# RESULT

## Files changed
- frontend/src/components/StudentEditorModal.jsx

## What changed, per file
- `StudentEditorModal.jsx`: imports `useAuth` from `'../App'` alongside
  the existing `useToast`, reads `accessToken` from it. `handleSave`
  now sends both requests with `Authorization: Bearer <accessToken>`
  (via a shared `headers` object built once per call). Create:
  `POST /api/tutor-students` → `POST /api/v1/students`. Update:
  `POST /api/tutor-students/:id/update` → `PUT /api/v1/students/:id`
  — the existing `student._id || student.id || student.roll_no`
  id-selection fallback needed no change. Error handling now reads
  `err.detail` instead of `err.error`. Nothing else touched: the
  payload object, the AI-OCR demo step, the wizard UI, and every other
  field input are byte-identical to before. `TutorClass.jsx` was not
  touched at all (confirmed via `git diff --stat`, empty).

## Tests
`vite build` after the change: clean, no new warnings (same
pre-existing chunk-size notice as prior slices). No browser automation
tool was available in this sandbox (same constraint as the auth
slice), so the actual rendered modal wasn't click-driven — instead,
every HTTP call the modal's `handleSave` now makes was reproduced
byte-for-byte (URL, method, headers, JSON body) against a **live**
stack: a throwaway `postgres:16` container migrated through all three
existing migrations, the real Express backend on port 5000, and the
real Vite dev server on port 3000 (confirming the `/api` proxy still
forwards `/api/v1/...`), with a real seeded `demo` college and a real
`principal` user.

1. **Create** — first attempt used the modal's literal placeholder-
   style mark values (`"94.2%"`, `"89.6%"`, `"82%"`) and got a real
   **500**, not a clean error — see the bug below. Retried with
   bare-numeric mark strings (`"94.2"`, `"89.6"`, `"82"`): **201**, full
   row returned with every field intact (`roll_no`, `full_name`,
   `phone_verified` correctly coerced to boolean, all optional fields,
   etc.), and no Aadhaar field anywhere in the request or response —
   confirmed there never was one in this modal to begin with.
2. **Update** — `PUT /api/v1/students/:id` with the same
   `Authorization` header changing `full_name`/`notes`: **200**, the
   updated row returned with the new values, `updated_at` advanced.
3. **Duplicate roll_no** — a second `POST` with the same `roll_no` in
   the same tenant: real **409** from the actual
   `students_college_id_roll_no_key` constraint,
   `{"detail":"roll_no \"CS24101\" already exists for this college"}`
   — exactly the string `showToast(err.message, 'danger')` would
   display, sourced from `err.detail` as the task specified.
4. **Validation error** — `POST` with only `roll_no`, no `full_name`
   (bypassing the wizard's own client-side guard, as the task asked to
   confirm): real **400**,
   `{"detail":"rollNo and fullName are required"}` — same
   `err.detail`-sourced display path.
5. Confirmed `frontend/src/pages/TutorClass.jsx` has zero diff
   (`git diff --stat` empty) and no other file besides
   `StudentEditorModal.jsx` changed.

## Flags / open questions
- **Real bug found: `mark_10th`/`mark_12th`/`mark_iti` are `NUMERIC`
  columns, but the modal's own UI invites free-text values that don't
  parse as numeric** — the input placeholders literally say `"e.g. 92%
  or 460/500"`, and sending `"94.2%"` (or any `/`-fraction) 500s at the
  DB layer (`invalid input syntax for type numeric`) rather than
  cleanly 400ing. This is a pre-existing schema/UI mismatch, not
  something this slice introduced — the ERD fixed these columns as
  `NUMERIC` back in the first Module 1 slice, before this modal's
  actual input conventions were checked against it. **Not fixed here**:
  the task explicitly said "no payload reshaping needed, at all — this
  is purely a URL/method/header/error-field change," and adding
  percent-stripping/fraction-parsing logic would be exactly the kind of
  reshaping that instruction ruled out. Whoever picks this up next
  needs to decide: change the columns to `TEXT` (matching what users
  actually type), or add real parsing/validation either client-side in
  this modal or server-side in `studentService`. Until then, any real
  user who types a `%` into those three fields (which the placeholder
  text actively encourages) gets an unhandled 500, not a friendly
  error.
- **No browser-level verification was possible in this sandbox** — same
  constraint as the auth slice: no `chromium-cli`/Playwright available,
  no Linux container/xvfb to run one. Every request was verified at
  the HTTP level against a real backend/DB using the modal's exact
  request shape, but the actual click-through (wizard steps, the Save
  Profile button, the toast rendering) was not driven through a real
  browser. Recommend a manual pass (or `/run-skill-generator` to
  capture a repeatable setup) before considering this fully verified.
- **`TutorClass.jsx`'s roster still won't show newly-created students**
  — expected and already called out in the task itself (different
  backend/data store entirely until a future module's slice repoints
  it); not re-litigated or patched around here.
