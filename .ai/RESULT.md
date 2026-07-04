# RESULT

## Files changed
- `backend/src/routes/documents.js` (new)
- `backend/src/tenantApp.js` (registered the router)
- `backend/tests/documents.test.js` (new)

No UI touched — matches this slice's scope.

## What was built
`/api/v1/documents` routes, matching `finance.js`'s conventions
(route-level `requireRole('principal')`/`requireAuth` placeholder RBAC,
snake_case<->camelCase body maps, `requireResolvedTenant` guard, a
`mapDocumentServiceError` helper):
`POST /documents`, `GET /documents/:id`, `GET /documents/:id/download`,
`GET /documents?student_id=...`, `POST /documents/:id/review`,
`DELETE /documents/:id`.

## Upload transport: base64 JSON (not multipart)
No `multer`/multipart parser exists anywhere in this codebase, and
`tenantApp.js` only registers `express.json()`. Rather than add a new
dependency for one route, `POST /documents` takes `file_base64` in the
same JSON body every other route already uses, decoded to a `Buffer`
before calling `documentService.uploadDocument`. Gets its own
route-level `express.json({ limit: '15mb' })` — not a global bump —
so only this endpoint's body-size ceiling changed (base64 adds ~33%
overhead over raw bytes; every other route keeps the default 100kb).
Download goes the other way: real bytes, `Content-Type`/
`Content-Disposition` headers, no JSON wrapping — flagged as a
deliberate v1 simplification, not final; a real multipart upload is
the natural next step once a UI needs to send a browser `File`
directly.

## docker-compose's missing DOCUMENT_STORAGE_ROOT volume: deferred
Confirmed it does not block this slice: `npm test` runs on the host,
writing straight to `backend/storage/` on the host filesystem — the
containerized `app` service (the one that would actually need the
volume) is never exercised by this slice's verification. Still open,
still flagged (ADR-017's own Consequences section already named it);
out of this slice's blast radius to fix.

## Verification
1. **New `documents.test.js`** (real HTTP + live Postgres + real
   filesystem, no mocking) — 16 cases: upload round-trips to a real
   file on disk with byte-for-byte match, missing-field/missing-actor
   400s, nonexistent-student 404, non-principal 403, metadata GET,
   cross-tenant 404 (a real RLS-backed isolation proof, not asserted
   against the admin/bypass role), download returns exact original
   bytes with correct headers, **a CRLF-in-`file_name` header-injection
   attempt is neutralized** (`Content-Disposition` sanitization
   proven, not just asserted safe by inspection), student-scoped list,
   review verifies + stamps the reviewer, review rejects an unknown
   status, review/delete both 404 on a nonexistent id, soft-delete
   both 204s and leaves the file on disk (retention). All pass.
2. **Full suite regression**: `npm test` — 381/381 passing (up from
   364: +17 from `documents.test.js`).

## Flags / open questions
- **No UI yet** — repointing `DocumentPanel.jsx` off its dead prototype
  endpoints is the next slice.
- **Upload is base64 JSON, not multipart** (restated above) — revisit
  once the UI slice needs to send a real browser `File`; base64's ~33%
  overhead and lack of streaming become real costs at that point, not
  before.
- **`docker-compose.yml` still has no volume for
  `DOCUMENT_STORAGE_ROOT`** (restated from ADR-017, confirmed
  non-blocking for this slice specifically) — needed before
  `docker compose up app` is deploy-safe.
- **RBAC is still the placeholder** (`principal` for every write) —
  restated from every other route file in this codebase; BusinessRules.md
  names no specific actor for document upload/verification yet (most
  likely the class tutor, not assumed here).
- **`WorkflowService` (Module 8) still unbuilt** (restated) —
  `POST /documents/:id/review` is a direct, ungated action.
