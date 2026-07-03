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

## Review — 2026-07-03 (post Module 0)

No change, and specifically: no new evidence either direction.
`BackgroundTasks` itself was never invoked anywhere in Module 0 — the
two places that could plausibly want it (password reset's email,
principal invitation's accept-link email) are both explicit stubs
(`501`, and a raw token returned directly in the response) precisely
*because* NotificationService doesn't exist yet, not because
`BackgroundTasks` was tried and found wanting.

Worth naming explicitly since it could look like a false positive: a
fair amount of manual, repetitive DB seeding happened this module
(Python scripts piped into the app container to seed test
tenants/admins/colleges for live verification). That is developer-time
test tooling, not application code — it never went through
`BackgroundTasks` or any request path at all, so it says nothing about
whether `BackgroundTasks` is adequate for real runtime background
work. Conflating "seeding was tedious" with "the task-queue decision
needs revisiting" would be answering a different question than the one
this row asks. Priority stays High, unchanged — the real trigger
(Documents/OCR, Notifications) hasn't been built yet per the Roadmap
order.
