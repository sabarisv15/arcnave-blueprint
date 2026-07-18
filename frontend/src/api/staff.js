import { api } from './client';

// Mirrors backend/src/routes/staff.js's STAFF_BODY_FIELDS exactly —
// that route reads snake_case keys off req.body, not the camelCase
// shape the RHF forms use internally.
const STAFF_FIELD_MAP = [
  ['userId', 'user_id'],
  ['staffCode', 'staff_code'],
  ['fullName', 'full_name'],
  ['gender', 'gender'],
  ['dob', 'dob'],
  ['phone', 'phone'],
  ['department', 'department'],
  ['departmentId', 'department_id'],
  ['designation', 'designation'],
  ['qualification', 'qualification'],
  ['hasPhd', 'has_phd'],
  ['aicteId', 'aicte_id'],
  ['joinedYear', 'joined_year'],
  ['address', 'address'],
];

function toStaffBody(payload) {
  const body = {};
  for (const [camelKey, snakeKey] of STAFF_FIELD_MAP) {
    if (payload[camelKey] !== undefined) body[snakeKey] = payload[camelKey];
  }
  return body;
}

export const staffApi = {
  list: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/staff${qs ? `?${qs}` : ''}`);
  },
  get: (id) => api.get(`/staff/${id}`),
  create: (payload) => api.post('/staff', toStaffBody(payload)),
  // routes/staff.js destructures username/email off req.body directly
  // (no snake_case translation, unlike the rest of STAFF_BODY_FIELDS)
  // — toStaffBody alone would silently drop both, since neither is in
  // STAFF_FIELD_MAP.
  createHodAccount: ({ username, email, ...rest }) =>
    api.post('/staff/hod-accounts', { username, email, ...toStaffBody(rest) }),
  update: (id, payload) => api.put(`/staff/${id}`, toStaffBody(payload)),
  remove: (id) => api.delete(`/staff/${id}`),
  submitRegistration: (id) => api.post(`/staff/${id}/submit-registration`),
  deactivate: (id) => api.post(`/staff/${id}/deactivate`),
};
