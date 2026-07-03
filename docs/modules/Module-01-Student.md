# Module 1 — Student Management

Status: Not started. This doc exists to carry forward frontend
grounding done in a prior Cowork session before implementation begins,
so a fresh chat/session doesn't have to re-derive it.

## Existing frontend to repoint (already read in full)

`frontend/src/components/StudentEditorModal.jsx` — the real, existing
student editor UI. Backend schema/API should be designed to satisfy
these actual fields, not invented ones:

roll_no, full_name, gender, entry_type, emis_number, umis_number,
email, phone, phone_verified, parent_name, parent_phone,
parent_phone_verified, address, pincode, mark_10th, mark_12th,
mark_iti, accommodation, club, internship, career_plan, notes,
license_number, bike_number.

- **No Aadhaar field** — consistent with `BusinessRules.md`'s
  Aadhaar prohibition (CLAUDE.md rule 8). Don't add one.
- The modal has a fake/randomized "AI OCR extraction" demo button —
  that's Module 6 (Documents & OCR) territory, not Module 1's. Ignore
  it when building Module 1; don't try to wire it up now.

## Not yet done

Schema, migration, repository, service, API, real tests — none of
this exists yet. Start per `Roadmap.md`'s vertical-slice order (ERD →
Migration → Repository → Service → API → UI → tests), same discipline
Module 0 used, in Node/Express per `docs/architecture/TechStack.md`.
