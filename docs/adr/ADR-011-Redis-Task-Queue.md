# ADR-011: Redis-backed task queue deferred

Status: Deferred (see Decisions-To-Revisit.md)

## Decision
Use FastAPI `BackgroundTasks` for v1 background work (send email
after approval, generate embeddings for a few uploaded PDFs, small
report generation). Do not introduce Celery/RQ/Dramatiq + Redis on
day one.

## Reasoning
`BackgroundTasks` is sufficient for lightweight, low-volume async
work and requires no new infrastructure. A real task queue is a
legitimate future need, not a day-one one.

## Revisit when
Long-running imports, thousands of notifications, bulk OCR, or large
analytics jobs make `BackgroundTasks` insufficient (request timeouts,
unacceptable delays). At that point, introduce Celery, RQ, Dramatiq,
or an equivalent, backed by Redis.
