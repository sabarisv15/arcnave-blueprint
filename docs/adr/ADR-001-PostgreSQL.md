# ADR-001: PostgreSQL over MongoDB

Status: Accepted

## Decision
Use PostgreSQL as the single database for all core domain data
(students, staff, attendance, marks, fees, timetable, placements),
plus JSONB for flexible/per-tenant config and pgvector for
embeddings.

## Alternatives considered
- **MongoDB** (the original codebase's choice): document-shaped,
  flexible schema, good fit for chat history/logs/OCR results, but
  weak at relational integrity and multi-record transactions.
- **PostgreSQL + MongoDB split**: relational data in Postgres,
  document data in Mongo. Rejected — two databases means two failure
  modes, no shared transaction across them, and an explicit
  write-ordering problem (what happens if the Postgres write
  succeeds but the Mongo log write fails).

## Reasoning
Students/Attendance/Marks/Fees/Timetable/Placements are inherently
relational — a student has attendance records, marks, fees, all tied
by foreign keys — and Fees/Marks specifically need real transactions
(a partial write on a fee payment is a real production bug in
MongoDB, handled properly by Postgres). JSONB gives Postgres the
schema flexibility MongoDB was chosen for, without needing a second
database. One database also means Row-Level Security (ADR-002) can
protect every table uniformly.

## Consequences
- The original Node/MongoDB backend is not migrated — it's rebuilt.
- Chat history, OCR results, logs, and settings live in Postgres
  JSONB tables instead of a separate MongoDB collection set.
