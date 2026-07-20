// Single lookup from an ERP entity type to the canonical route already
// declared in app/routes.jsx. Never invent a route here — if a tool
// result references an entity type with no route below, callers must
// render plain text instead of a link. If a route is renamed in
// app/routes.jsx, this is the one place that needs updating.
const ENTITY_ROUTE_BUILDERS = {
  student: (id) => `/students/${id}`,
  staff: (id) => `/staff/${id}`,
  class: (id) => `/academic/classes/${id}`,
};

export function resolveEntityRoute(entityType, id) {
  if (!entityType || id === undefined || id === null || id === '') return null;
  const build = ENTITY_ROUTE_BUILDERS[entityType];
  return build ? build(id) : null;
}

// A raw tool row's own primary key is just `id` (confirmed against the
// real /ai/tools/students_roster/invoke response — studentRepository
// never aliases it to student_id), so the entity TYPE can only be
// inferred from which tool produced the row, not from the row's own
// field names. Only tools whose result rows are one full record per
// entity are listed — never invented for a tool that returns something
// else shaped (a summary, a mixed join, etc.).
const TOOL_ENTITY_TYPES = {
  students_roster: 'student',
  students_low_attendance: 'student',
  staff_roster: 'staff',
};

// Returns { entityType, id } or null. `toolUsed` is the message's own
// toolUsed field — never guessed from the record's shape.
export function inferEntityFromRecord(record, toolUsed) {
  if (!record || typeof record !== 'object') return null;
  const entityType = TOOL_ENTITY_TYPES[toolUsed];
  if (!entityType) return null;
  const id = record.id ?? record[`${entityType}_id`];
  if (id === undefined || id === null) return null;
  return { entityType, id };
}
