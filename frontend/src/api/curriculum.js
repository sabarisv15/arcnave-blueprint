import { api } from './client';

const SUBJECT_FIELD_MAP = [
  ['subjectCode', 'subject_code'],
  ['subjectName', 'subject_name'],
  ['semester', 'semester'],
  ['credits', 'credits'],
  ['lectureHours', 'lecture_hours'],
  ['tutorialHours', 'tutorial_hours'],
  ['practicalHours', 'practical_hours'],
  ['subjectType', 'subject_type'],
  ['prerequisites', 'prerequisites'],
  ['sourceDocumentId', 'source_document_id'],
];

function toSubjectBody(payload) {
  const body = {};
  for (const [camelKey, snakeKey] of SUBJECT_FIELD_MAP) {
    if (payload[camelKey] !== undefined) body[snakeKey] = payload[camelKey];
  }
  return body;
}

export const curriculumApi = {
  listRegulations: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/regulations${qs ? `?${qs}` : ''}`);
  },
  getRegulation: (id) => api.get(`/regulations/${id}`),
  createRegulation: ({ name, description }) => api.post('/regulations', { name, description }),

  listSubjects: (regulationId) => api.get(`/regulations/${regulationId}/subjects`),
  createSubject: (regulationId, payload) => api.post(`/regulations/${regulationId}/subjects`, toSubjectBody(payload)),
  updateSubject: (id, payload) => api.put(`/subjects/${id}`, toSubjectBody(payload)),
  removeSubject: (id) => api.delete(`/subjects/${id}`),

  requestCurriculumMigration: (studentId, toRegulationId) =>
    api.post(`/students/${studentId}/curriculum-migration`, { to_regulation_id: toRegulationId }),
  approveCurriculumMigration: (studentId) => api.post(`/students/${studentId}/curriculum-migration/approve`),
  rejectCurriculumMigration: (studentId) => api.post(`/students/${studentId}/curriculum-migration/reject`),
};
