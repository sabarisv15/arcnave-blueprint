# TASK

## Objective (Module 6 — Documents & OCR — third vertical slice)
`/api/v1/documents` routes only, on top of `documentService.js`
(ee46702) — no UI yet. Match `finance.js`'s route conventions (route-
level RBAC placeholder, snake_case<->camelCase body translation,
`requireResolvedTenant` guard, a `mapXServiceError` helper).

## Upload transport: base64 JSON, not multipart
No `multer` (or any multipart parser) exists in this codebase yet, and
`tenantApp.js` only registers `express.json()`. Adding a new dependency
for one route is a bigger call than this slice needs — `documentService.uploadDocument`
just needs a `Buffer`; a base64 string in the same JSON body every
other route already uses gets there with zero new dependencies.
`POST /documents` gets its own route-level `express.json({ limit: '15mb' })`
(not a global bump) so this is the only endpoint whose body-size
ceiling changed. Flagged as a deliberate v1 simplification, not a final
call — a real multipart upload (streamed, no base64 33% overhead) is
the natural thing to switch to once the UI slice needs to send a
browser `File` directly, not guessed at here.
Download goes the other way — real bytes, `Content-Type`/
`Content-Disposition` headers, no base64 wrapping — since GET responses
were never bound to the JSON-body convention upload was.

## docker-compose's missing DOCUMENT_STORAGE_ROOT volume (ADR-017)
Deferred, not fixed. Tests run on the host (`npm test` outside any
container), writing straight to `backend/storage/` on the host
filesystem — the containerized `app` service (which does need a
volume) is never exercised by this slice's verification. Still a real,
flagged gap for whoever deploys via `docker compose up app` before a
volume is added; not this slice's job to fix, since it isn't in this
slice's blast radius at all.

## RBAC
Same placeholder every other route file in this codebase uses
(`students.js`/`staff.js`/`finance.js`): `requireRole('principal')`
gates every write (upload, review, delete), `requireAuth` gates every
read (get, list, download). BusinessRules.md names no specific actor
for document upload/verification — same "must be revisited once a real
role model exists" caveat those other files already carry, restated
here rather than invented differently.

## Endpoints
- `POST /documents` — upload (`student_id`, `doc_type`, `file_name`,
  `mime_type`, `file_base64`)
- `GET /documents/:id` — metadata
- `GET /documents/:id/download` — real bytes, correct headers
- `GET /documents?student_id=...` — list for a student (`student_id`
  required, mirrors `finance.js`'s fee-payments list)
- `POST /documents/:id/review` — `{ status, remarks }`
- `DELETE /documents/:id` — soft-delete, 204

## Files affected
- `backend/src/routes/documents.js` (new)
- `backend/src/tenantApp.js` (register the router)
- `backend/tests/documents.test.js` (new — HTTP-level, real DB + real
  filesystem, same shape as `finance.test.js`)

## Verification
- New route-level test file against the real dev server + live
  Postgres + real `fileStorage` disk writes: upload round-trips through
  to a real file on disk, download returns the exact original bytes
  with the right headers, review/list/delete each exercised, tenant
  isolation (cross-tenant 404s, not a leak), a `Content-Disposition`
  header-injection attempt in `file_name` is neutralized.
- Full `npm test` regression run.
