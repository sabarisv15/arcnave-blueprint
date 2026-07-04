# Module 4 — Attendance

Status: Complete (migration → repository → service → API → UI).

## Table
`attendance_sessions` — one row per (class, date, hour): a period's
roll call, not a per-student row. Grounded against the real
StaffDashboard.jsx mark-attendance flow (`{ tutor_id, hour_index,
absent_rolls, date_key }` per period) — a normalized per-student table
was considered and rejected, same reasoning Module 3 used for not
normalizing `timetable_data`. `class_id` replaces the prototype's
`tutor_id`. `hour_index` matches `timetable_data`'s grid column
position, no CHECK bound (grid can change shape).

## Service
`attendanceService.js` — validation, authorization, audit logging over
`attendanceRepository.js`. Reads timetable/approval state through
`academicService.getClass` (never `classRepository` directly —
Architecture.md 2.5). Enforces CLAUDE.md rule 7: marking is locked
until `timetable_status == 'Approved'`. Third named eligible marker
("staff scheduled for that period") initially could not be verified —
triggered Module 3's `faculty_allocation` slice to make it real
(`576ca6b` wires the resolved link in).

## API
`backend/src/routes/attendance.js` — `/api/v1/attendance`.

## UI
`StaffDashboard.jsx`'s mark-attendance flow repointed to the real API
(`32f61bb`).

## Known gaps / deferred
- No "all attendance rows for student X" query shape — nothing in the
  real UI needs it yet; revisit if a real screen does.

## Commits
`49c8b4b` migration+repo · `82f8479` service · `7e466ec` API ·
`576ca6b` faculty-allocation authorization patch · `32f61bb` UI
