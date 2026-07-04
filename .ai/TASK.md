# TASK

## Objective (Module 6 — Documents & OCR — fourth/final vertical slice, UI)
Repoint `DocumentPanel.jsx` off its dead prototype endpoints onto the
real `/api/v1/documents` routes (32ddf95), and wire it into a real
screen. No new page.

## Grounding: where it belongs
`StudentEditorModal.jsx` already has the exact precedent to follow: its
existing "Finance" step (e4eb36b) is edit-mode-only, appended after
`BASE_STEPS`, fetched lazily only when the step is actually viewed —
because `fee_payments.student_id` is a real FK, so Finance data only
makes sense once a student row (a real `student.id`) exists. The same
is true of `documents.student_id`. Documents becomes a second appended,
edit-mode-only step, same shape.

`Profile.jsx` was checked and is the wrong fit: it's a *staff* profile
page (`/api/users/:username`, department, AICTE ID, teaching workload)
— Module 6's own scope is student certificates/photos/files only, not
staff documents (a separate, out-of-scope DocumentService
responsibility per Architecture.md 2.5).

## The old "Upload Documents" step (index 0) is deleted outright, not repointed
It was never a real upload step — `handleFileChange` just set a canned
filename string, and `runDocumentExtraction` was a fully fake
`setInterval` OCR simulation that invents a fictional student
("Aravind Swamy") and auto-fills the form. This is exactly the
OCR-trigger flow this session's own scope excludes (Module 9). It's
deleted, not stripped-and-kept: a real document upload needs a real
`student.id` (the FK), which doesn't exist yet during the "Add New
Student" flow this step used to run in — same reason Finance isn't
shown there either. `BASE_STEPS` shrinks to `[Personal, Academic,
Career Info]`; edit mode appends `[Documents, Finance]`. The
`disabled={index > 1 ...}` step-lock guard becomes `index > 0` — with
"Upload Documents" gone, Personal (now index 0) is the only step
free before roll/name are required, same intent as before, adjusted
for the one fewer leading step.

## DocumentPanel.jsx: OCR stripped, wired to the real API
- `handleOCR`, `ocrRunning`, `ocrResults`, the `Cpu`/AI-Extract button,
  the AI-confidence bar, and the whole OCR Results table are deleted —
  Module 9 territory, not this slice's.
- `status` values narrow to the three the real API actually has:
  `uploaded` / `verified` / `rejected`, plus a client-only
  `not_uploaded` pseudo-state for "no document of this type exists
  yet" (never sent to the server — purely a rendering shorthand).
- `DOC_TYPES` gains `photo` — the Module 6 migration's own known-
  category list names 9 types (8 certs + photo); the prototype only
  had 8.
- Upload: real `File` -> base64 client-side (`FileReader.readAsDataURL`,
  strip the `data:...;base64,` prefix), `POST /api/v1/documents` with
  `{student_id, doc_type, file_name, mime_type, file_base64}` — the
  same base64-JSON contract the API slice chose (32ddf95), not
  multipart.
- Download: an authenticated `fetch` (the download route requires
  `requireAuth` — a plain `<a href>` can't attach a Bearer header),
  response turned into a Blob, opened via a temporary object URL.
- Verify/Reject: `POST /api/v1/documents/:id/review`.
- The panel now takes the *list* of a student's documents (every
  version, newest first — no unique constraint on `(student_id,
  doc_type)`, matches the repository's own versioning design) and
  reduces it to "latest per `doc_type`" client-side (first occurrence
  in the newest-first array) — no new "latest" endpoint needed, the
  existing `GET /documents?student_id=` list already sorts that way.

## canUpload/canVerify: matches what the API will actually accept, not invented
`requireRole('principal')` gates every document write today (upload,
review) — this session's own instruction: known placeholder, not a
decision to fix here. Wiring `canUpload`/`canVerify` to
`currentUser.role === 'principal'` in `StudentEditorModal` isn't a new
RBAC opinion, just matching the UI to what would otherwise show
controls that 403 on click — same restraint every other write-gated
screen in this codebase already applies.

## Files affected
- `frontend/src/components/DocumentPanel.jsx`
- `frontend/src/components/StudentEditorModal.jsx`

## Verification
- `npm run build` — compiles cleanly.
- Live API-shape proof against the real `docker-compose` Postgres (no
  browser-automation tooling for a real click-through — same
  substitute technique every prior Finance UI slice used): seed a
  tenant + principal + student, issue the exact requests the panel
  makes (upload with a real base64 payload, list, review, download),
  confirm shapes/statuses match what the component expects.
- Headless Chrome screenshot (`chrome.exe --headless --screenshot`) —
  confirms the app still renders after the change, not a build-only
  proxy for "it works."
