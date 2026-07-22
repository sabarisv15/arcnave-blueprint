import { api } from './client';

// Mirrors backend/src/routes/classes.js's CLASS_BODY_FIELDS.
// tutor_user_id is deliberately absent — createClass/updateClass
// reject it outright; Class Tutor assignment goes through
// assignTutor/reassignTutor below instead (POST/PUT /classes/:id/tutor).
const CLASS_FIELD_MAP = [
  ['className', 'class_name'],
  ['department', 'department'],
  ['departmentId', 'department_id'],
  ['semester', 'semester'],
  ['timetableStatus', 'timetable_status'],
  ['timetableData', 'timetable_data'],
  ['timetableRemarks', 'timetable_remarks'],
];

function toClassBody(payload) {
  const body = {};
  for (const [camelKey, snakeKey] of CLASS_FIELD_MAP) {
    if (payload[camelKey] !== undefined) body[snakeKey] = payload[camelKey];
  }
  return body;
}

export const classesApi = {
  list: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/classes${qs ? `?${qs}` : ''}`);
  },
  get: (id) => api.get(`/classes/${id}`),
  create: (payload) => api.post('/classes', toClassBody(payload)),
  update: (id, payload) => api.put(`/classes/${id}`, toClassBody(payload)),
  remove: (id) => api.delete(`/classes/${id}`),

  submitForApproval: (id) => api.post(`/classes/${id}/submit-for-approval`),
  // HOD-only, own-department (own-class's department). assignTutor is
  // first-time assignment (409 if the class already has one);
  // reassignTutor changes an existing one (404 if none exists yet).
  assignTutor: (id, newTutorUserId) => api.post(`/classes/${id}/tutor`, { new_tutor_user_id: newTutorUserId }),
  reassignTutor: (id, newTutorUserId) => api.put(`/classes/${id}/tutor`, { new_tutor_user_id: newTutorUserId }),
  promoteSemester: (id) => api.post(`/classes/${id}/promote-semester`),
  sendAlert: (id, body) => api.post(`/classes/${id}/send-alert`, { body }),

  listSubstituteAssignments: (id) => api.get(`/classes/${id}/substitute-assignments`),
  createSubstituteAssignment: (id, payload) => api.post(`/classes/${id}/substitute-assignments`, {
    timetable_period_id: payload.timetablePeriodId,
    assignment_date: payload.assignmentDate,
    original_staff_user_id: payload.originalStaffUserId,
    substitute_staff_user_id: payload.substituteStaffUserId,
    reason: payload.reason,
  }),

  generateTimetable: (id, requirements) => api.post(`/classes/${id}/generate-timetable`, {
    requirements: requirements.map((r) => ({
      subject: r.subject, staff_user_id: r.staffUserId, periods_per_week: r.periodsPerWeek,
    })),
  }),

  listTimetableRevisions: (id) => api.get(`/classes/${id}/timetable-revisions`),
  getEffectiveTimetableRevision: (id, date) =>
    api.get(`/classes/${id}/timetable-revisions/effective${date ? `?date=${date}` : ''}`),
};
