# ADR-017: Local disk storage for DocumentService (v1)

Status: Accepted

## Decision
`DocumentService` writes uploaded files to local disk, under a
tenant-prefixed directory tree rooted at `DOCUMENT_STORAGE_ROOT`
(default `backend/storage/`, gitignored). No S3/object-storage
dependency this slice.

## Reasoning
TechStack.md names no storage backend at all (only Node equivalents of
openpyxl/python-docx/ReportLab for *generating* files) — genuinely
undecided, not a gap in this ADR's research. Two facts already in this
project settle it in favor of disk for v1:

- **ADR-014**: a single Express instance, horizontal scaling explicitly
  deferred. S3's main advantage — a shared blob store reachable from
  N stateless instances — buys nothing until a second instance exists.
- **Deployment target (TechStack.md)**: Docker + Nginx + Postgres
  backups only. No object-storage credential/bucket is provisioned
  anywhere; adding one now is infrastructure this project doesn't run
  yet, for a problem it doesn't have yet.

Local disk under a Docker named volume is the same pattern already
proven for Postgres itself (`pgdata` in `docker-compose.yml`) —
persists across container restarts, zero new infra, zero new
credentials.

## Consequences
- `backend/src/storage/fileStorage.js` is the only code that touches
  the filesystem for documents (ADR-009: DocumentService, and nothing
  else, owns storage).
- `docker-compose.yml` does not yet mount a named volume for
  `DOCUMENT_STORAGE_ROOT` — a real, flagged gap for whoever deploys
  this before Module 6's UI slice, not solved in this ADR.
- Backups: Postgres has `pg_dump`; uploaded files on local disk do not
  yet have an equivalent backup story. Flagged, not solved here.

## Revisit when
A second application instance is actually provisioned (ADR-014's own
trigger) — at that point local disk stops being viable (files written
to instance A are invisible to instance B) and this ADR should be
superseded in favor of S3 or an S3-compatible store (MinIO, etc.).
