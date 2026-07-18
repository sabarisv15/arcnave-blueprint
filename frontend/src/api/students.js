import { api } from './client';

// Mirrors backend/src/routes/students.js's STUDENT_BODY_FIELDS exactly
// — that route reads snake_case keys off req.body (roll_no, full_name,
// ...), not the camelCase names studentService/the RHF forms use
// internally. Translate once here so every caller can keep working in
// camelCase.
const STUDENT_FIELD_MAP = [
  ['rollNo', 'roll_no'],
  ['fullName', 'full_name'],
  ['gender', 'gender'],
  ['entryType', 'entry_type'],
  ['emisNumber', 'emis_number'],
  ['umisNumber', 'umis_number'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['phoneVerified', 'phone_verified'],
  ['parentName', 'parent_name'],
  ['parentPhone', 'parent_phone'],
  ['parentPhoneVerified', 'parent_phone_verified'],
  ['address', 'address'],
  ['pincode', 'pincode'],
  ['mark10th', 'mark_10th'],
  ['mark12th', 'mark_12th'],
  ['markIti', 'mark_iti'],
  ['accommodation', 'accommodation'],
  ['club', 'club'],
  ['internship', 'internship'],
  ['careerPlan', 'career_plan'],
  ['notes', 'notes'],
  ['licenseNumber', 'license_number'],
  ['bikeNumber', 'bike_number'],
  ['annualIncome', 'annual_income'],
  ['classId', 'class_id'],
];

function toStudentBody(payload) {
  const body = {};
  for (const [camelKey, snakeKey] of STUDENT_FIELD_MAP) {
    if (payload[camelKey] !== undefined) body[snakeKey] = payload[camelKey];
  }
  return body;
}

// Mirrors routes/students.js's lifecycle-status routes, which destructure
// new_status/reason/effective_date off req.body (snake_case), not the
// camelCase shape features/students/schemas.js's form uses.
function toLifecycleBody({ newStatus, reason, effectiveDate } = {}) {
  const body = {};
  if (newStatus !== undefined) body.new_status = newStatus;
  if (reason !== undefined) body.reason = reason;
  if (effectiveDate !== undefined) body.effective_date = effectiveDate;
  return body;
}

export const studentsApi = {
  list: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/students${qs ? `?${qs}` : ''}`);
  },
  get: (id) => api.get(`/students/${id}`),
  create: (payload) => api.post('/students', toStudentBody(payload)),
  update: (id, payload) => api.put(`/students/${id}`, toStudentBody(payload)),
  remove: (id) => api.delete(`/students/${id}`),

  listTransferRequests: (id) => api.get(`/students/${id}/transfer-requests`),
  createTransferRequest: (id, payload) => api.post(`/students/${id}/transfer-requests`, payload),
  approveTransferRequest: (id, transferRequestId) =>
    api.post(`/students/${id}/transfer-requests/${transferRequestId}/approve`),
  rejectTransferRequest: (id, transferRequestId) =>
    api.post(`/students/${id}/transfer-requests/${transferRequestId}/reject`),

  changeLifecycleStatus: (id, payload) => api.post(`/students/${id}/lifecycle-status`, toLifecycleBody(payload)),
  requestLifecycleStatusChange: (id, payload) =>
    api.post(`/students/${id}/lifecycle-status/request`, toLifecycleBody(payload)),
  approveLifecycleStatusChange: (id, payload) =>
    api.post(`/students/${id}/lifecycle-status/approve`, { effective_date: payload?.effectiveDate }),
  rejectLifecycleStatusChange: (id) => api.post(`/students/${id}/lifecycle-status/reject`),
  listLifecycleEvents: (id) => api.get(`/students/${id}/lifecycle-events`),

  requestPhoneOtp: (id, target) => api.post(`/students/${id}/phone-verification/otp`, { target }),
  verifyPhoneOtp: (id, target, code) => api.post(`/students/${id}/phone-verification/verify`, { target, code }),
};
