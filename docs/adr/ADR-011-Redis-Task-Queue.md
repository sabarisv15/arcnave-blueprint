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

## Addendum — 2026-07-03 (post ADR-016)

Not a rewrite of the decision above — a note that the *named
mechanism* it decided on no longer exists. ADR-016 replaced the Python
backend with Express (Node.js); `FastAPI BackgroundTasks` isn't
something Express has an equivalent of built in, and nothing has
replaced it. This is a real gap, not a wording difference — tracked in
`Decisions-To-Revisit.md`'s Redis Task Queue row, whose Current Choice
now honestly reads "none chosen yet" rather than naming a mechanism
that no longer applies.

Deliberately not resolved here: a Node v1 equivalent (a plain
`setImmediate`/`setTimeout`-based approach, a lightweight job table,
or something else) is a real technical decision nobody has made yet,
and picking one now — with no actual background-work use case built to
validate the choice against — would be exactly the kind of
guessed-ahead-of-need decision this module has deliberately avoided
everywhere else. It gets chosen when Module 8 (Workflow &
Notifications) first actually needs background work, not before. The
`BackgroundTasks`-vs-Celery *question itself* (light in-process work
vs. a real task queue) is unaffected by the language switch and
doesn't need re-litigating — only "light in-process work" needs a new
Node-shaped answer.
