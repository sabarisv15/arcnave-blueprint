# RESULT

## Files changed
- `frontend/src/components/DocumentPanel.jsx`
- `frontend/src/components/StudentEditorModal.jsx`

No backend files touched — matches this slice's UI-only scope.

## What was built
`DocumentPanel.jsx` repointed off its dead prototype endpoints onto
the real `/api/v1/documents` routes (32ddf95), and wired into
`StudentEditorModal.jsx` as a new edit-mode-only "Documents" step —
same shape as the existing "Finance" step (e4eb36b): appended, lazily
fetched only when actually viewed, gated on a real `student.id`.
`Profile.jsx` was checked and is the wrong screen (a *staff* profile
page — department/AICTE ID/workload — not student documents, which
are Module 6's whole scope).

**The old "Upload Documents" step (index 0) was deleted outright, not
repointed.** It was never a real upload — `handleFileChange` just set
a canned filename string, and `runDocumentExtraction` was a fully fake
`setInterval` OCR simulation that invented a fictional student
("Aravind Swamy") and auto-filled the form — exactly the OCR-trigger
flow this session's scope excludes (Module 9). It also structurally
couldn't become real: it ran during "Add New Student," before any
`student.id` exists, and `documents.student_id` is a real FK.
`BASE_STEPS` shrank to `[Personal, Academic, Career Info]`; edit mode
appends `[Documents, Finance]`. The step-lock guard changed from
`index > 1` to `index > 0` (one fewer leading free step).

`DocumentPanel.jsx` changes:
- OCR entirely removed: `handleOCR`, `ocrRunning`, `ocrResults`, the
  AI-Extract button, the confidence bar, the whole results table.
- `status` narrowed to the real API's three values
  (`uploaded`/`verified`/`rejected`) plus a client-only
  `not_uploaded` pseudo-state (never sent to the server).
- `DOC_TYPES` gained `photo` — the Module 6 migration's own
  known-category list names 9 types; the prototype only had 8.
- Upload: real `File` → base64 (`FileReader.readAsDataURL`, strip the
  `data:...;base64,` prefix) → `POST /api/v1/documents`, matching the
  base64-JSON contract the API slice chose (32ddf95).
- Download: authenticated `fetch` (the route requires `requireAuth`;
  a plain `<a href>` can't attach a Bearer header) → Blob → temporary
  object URL, not a static link.
- Verify/Reject: `POST /api/v1/documents/:id/review`.
- The panel takes the full per-student document list (every version,
  newest first) and reduces it to "latest per `doc_type`" client-side
  — no new "latest" endpoint needed, the existing list is already
  sorted that way.
- `canUpload`/`canVerify` wired to `user.role === 'principal'` in
  `StudentEditorModal` — matches what `requireRole('principal')`
  actually accepts today, not a new RBAC opinion (restated: known
  placeholder, not this slice's call to fix).

## Verification
1. **`npm run build`** — 1511 modules transform cleanly (one more than
   before: `DocumentPanel` is now actually imported).
2. **Live API-shape proof** against the real `docker-compose` Postgres
   + a real running dev server (no browser-automation click-through
   tooling available — same substitute technique every prior Finance
   UI slice used, via `node:http` rather than `fetch`, since `fetch`/
   undici forbids overriding the `Host` header this app's tenant
   resolution needs): seeded a tenant + principal + student, then
   issued the exact requests the panel makes — upload (real base64
   payload) returned `201`/`uploaded`, list returned the row with
   `doc_type`/`status` present, review returned `verified` stamped
   with the real `verified_by_user_id`, download returned the exact
   original bytes with `Content-Type: application/pdf` and a correct
   `Content-Disposition`. All 5 checks passed; seeded data cleaned up
   after (a first cleanup attempt missed FK ordering —
   `refresh_tokens`/`audit_log` before `users` — fixed and reverified
   0 leftover rows).
3. **Headless Chrome screenshot** (`chrome.exe --headless
   --screenshot`) of the running dev server's `/login` — confirms the
   app still renders correctly (real login screen, not blank/broken)
   after the change.
4. **Full backend suite regression**: `npm test` — 381/381 passing,
   unchanged (this slice touched no backend files).

## Flags / open questions
- **Module 6 (Documents & OCR) is now fully vertical**: migration →
  repository (9b7d779) → service (ee46702) → API (32ddf95) → UI (this
  slice). OCR/AI extraction itself remains entirely unbuilt — Module 9
  territory, never touched across any of these four slices.
- **RBAC still the placeholder** (`principal`-only writes) — restated
  per this session's own explicit instruction, not fixed here.
- **No click-through browser test** (Playwright/Cypress or similar) —
  this codebase has none set up for any screen yet; verification used
  the same build+live-API-shape+screenshot substitute every other UI
  slice in this project has used.
- **`docker-compose.yml` still has no volume for
  `DOCUMENT_STORAGE_ROOT`** (ADR-017, restated, still open) — a real
  browser file upload through this new UI, running against
  `docker compose up app` rather than a host-run dev server, would
  lose its files on container recreation until that volume exists.
