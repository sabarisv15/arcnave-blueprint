# ADR-009: DocumentService owns all file storage

Status: Accepted

## Decision
Every file write in the system — user uploads, AI-generated exports,
templates — goes through `DocumentService`. No other service, and no
AI tool, writes to Storage directly, even for pure file-generation
operations with no database write involved.

## Alternatives considered
- **AI Generate Tools write straight to Storage**: considered and
  explicitly rejected. Even though a generated Excel file involves no
  DB write, letting tools bypass DocumentService means storage paths,
  tenant folder scoping, naming conventions, and retention policy get
  reimplemented (and inevitably drift) wherever a tool decides to
  write a file.

## Reasoning
Single writer per resource. The AI should never know storage paths,
folder names, bucket names, naming conventions, retention policy, or
tenant folder structure — those are infrastructure concerns owned by
one service. This also gives `DocumentService` a natural home for
future concerns (virus scanning, versioning) without touching every
caller.

## Consequences
- `AI Agent → Report Tool → ReportService → Generator → bytes →
  DocumentService → Storage → download URL` — no shortcuts, even for
  "just a file, no DB involved" cases.
