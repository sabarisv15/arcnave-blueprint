# ADR-007: Flutter for mobile (and future desktop)

Status: Accepted

## Decision
Build the mobile AI app in Flutter, not React Native.

## Alternatives considered
- **React Native**: shares a language (JavaScript) and some patterns
  with the existing React web frontend. This was the initial default
  recommendation.
- **Wrapped PWA**: fastest to ship, weakest "real app" feel; rejected
  for a product meant to feel like a native assistant.

## Reasoning
React Native's advantage is code-sharing with the React web frontend
— but that sharing is partial at best (business logic, not UI, and
even that is limited). Flutter's real advantage is that it also
targets **desktop natively from the same codebase**, so "Future
Desktop App" — already a stated product goal — becomes nearly free
once mobile is built, rather than a second from-scratch client later.

## Consequences
- No code-sharing between the React web frontend and the Flutter
  mobile/desktop app — they are two separate frontend codebases
  against the same `/api/v1` backend.
- Both clients depend on the same JWT-based auth (not the original
  codebase's cookie/session auth), since native mobile apps handle
  cookies poorly across app restarts.
