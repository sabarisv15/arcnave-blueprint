# Module 3 — Academic

Status: Complete (migration → repository → service → API → UI, two
slices: `classes` then `timetable_periods` + `faculty_allocation`).

## Tables
- `classes` — class/section identity. Tutor-of-record is no longer a
  column on this table: Class Tutor is a full Institutional Position
  Account (`positions.position_type='class_tutor'`), assigned via
  `POST`/`PUT /classes/:id/tutor`, not a `tutor_user_id` FK (Phase 2 —
  see BusinessRules' Staff section "Resolved (Phase 2)" entry and
  ADR-021's Amendments). `timetable_data` JSONB (opaque CSV-derived
  grid — matches
  the real TutorClass.jsx/TutorClassMonitor.jsx rendering, not
  normalized), `timetable_status` (`No Tutor`/`Pending HOD`/`Pending
  Principal`/`Approved`/`Rejected` — no CHECK, service-enforced).
  `Approved` is the literal gate value CLAUDE.md rule 7 references for
  unlocking Attendance.
- `timetable_periods` — shared bell schedule, one row per
  (college_id, day_of_week, hour_index). Added later, triggered by
  Module 4's second slice needing a real link to verify "the staff
  member scheduled for a period" (see attendanceService.js, `82f8479`).
- `faculty_allocation` — who teaches what, when; the structured link
  `classes.timetable_data`'s free-text grid couldn't support. Purely
  additive — `timetable_data` display is untouched.

## Service
`academicService.js` — plain CRUD + validation over
`classRepository.js`, same shape as `staffService.js`. No timetable
upload→structured-data sync logic yet (flagged, not built).

## API
`backend/src/routes/classes.js`, `facultyAllocation.js`,
`timetablePeriods.js` — all under `/api/v1/`.

## UI
`classesList` repointed to the real API (`dbe8380`).

## Known gaps / deferred
- No raw timetable file storage (needs DocumentService — didn't exist
  until Module 6; not retrofitted here).
- No CSV-upload logic that populates `timetable_data` and
  `faculty_allocation` together — real AcademicService logic, deferred.

## Commits
`ef0a76c` classes migration+repo · `70b6e68` service · `235aa8b` API ·
`dbe8380` UI · `4fa8f12` timetable_periods+faculty_allocation
migration+repo · `8b66a4c` faculty allocation business logic ·
`e36bfb8` API
