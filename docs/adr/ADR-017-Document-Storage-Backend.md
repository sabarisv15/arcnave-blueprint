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
- `docker-compose.yml` mounts a named volume (`document_storage`) at
  `DOCUMENT_STORAGE_ROOT` (`/app/storage`), the same durability pattern
  already proven for Postgres's own `pgdata` — closes this ADR's own
  previously-flagged gap. In local dev this happened to be covered
  already by the `./backend:/app` bind mount, but that was coincidental
  (true only because the whole backend directory is bind-mounted for
  hot-reload) and would not hold for a production-style deployment that
  `COPY`s the image instead of bind-mounting source — the named volume
  is not coincidental, and works the same way regardless of deployment
  style.

## Backup & Encryption plan
Neither is implemented in code by this ADR — both are documented here
as the plan to implement against, same "flagged, not solved" posture
this project uses elsewhere (e.g. ADR-020) until a real deployment
needs it.

- **Backups**: Postgres already has `pg_dump`; uploaded files need an
  equivalent for the `document_storage` volume. Plan: a scheduled job
  that archives the volume (`tar`/`rsync` the volume's contents, or a
  Docker-native `docker run --rm -v document_storage:/data -v
  $BACKUP_DIR:/backup ... tar czf /backup/documents-$(date).tar.gz
  /data`) alongside the existing `pg_dump`, both shipped to the same
  off-site/off-host location on the same schedule — a document backup
  with no matching database backup (or vice versa) is not a restorable
  system, since `documents.storage_path` rows and the bytes on disk
  must agree. Restore is untested until this is actually built; a real
  restore drill is part of "done," not optional.
- **Encryption at rest**: not implemented. Plan: host/volume-level
  encryption (e.g. LUKS on the Docker host, or the cloud provider's
  managed-disk encryption once this deploys somewhere other than local
  dev) rather than application-level per-file encryption — the same
  "don't build infrastructure this project doesn't run yet" reasoning
  this ADR already gives for deferring S3. Volume-level encryption is
  transparent to `fileStorage.js` (no code change needed to adopt it)
  and covers the whole volume, including any future file type, not
  just what's anticipated today. Revisit application-level encryption
  only if a specific document classification (e.g. Confidential/
  Restricted per ADR-020's classification matrix) is judged to need
  protection independent of host/disk compromise.

## Revisit when
A second application instance is actually provisioned (ADR-014's own
trigger) — at that point local disk stops being viable (files written
to instance A are invisible to instance B) and this ADR should be
superseded in favor of S3 or an S3-compatible store (MinIO, etc.).
