import { api } from './client';

export const facultyAllocationApi = {
  listForClass: (classId) => api.get(`/faculty-allocation?class_id=${classId}`),
  listForStaff: (staffUserId) => api.get(`/faculty-allocation?staff_user_id=${staffUserId}`),
  get: (id) => api.get(`/faculty-allocation/${id}`),
  create: ({ classId, periodId, subject, staffUserId }) => api.post('/faculty-allocation', {
    class_id: classId, period_id: periodId, subject, staff_user_id: staffUserId,
  }),
  remove: (id) => api.delete(`/faculty-allocation/${id}`),
};
