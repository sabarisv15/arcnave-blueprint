import { api } from './client';

export const attendanceApi = {
  mark: ({ classId, sessionDate, hourIndex, absentStudentIds, totalStudents }) => api.post('/attendance', {
    class_id: classId,
    session_date: sessionDate,
    hour_index: hourIndex,
    absent_student_ids: absentStudentIds,
    total_students: totalStudents,
  }),
  get: (id) => api.get(`/attendance/${id}`),
  getEffective: (id) => api.get(`/attendance/${id}/effective`),
  listForClass: (classId, { sessionDate, startDate, endDate } = {}) => {
    const params = new URLSearchParams({ class_id: classId });
    if (sessionDate) params.set('session_date', sessionDate);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return api.get(`/attendance?${params.toString()}`);
  },
  lock: (id) => api.post(`/attendance/${id}/lock`),

  requestCorrection: (id, { proposedAbsentStudentIds, proposedTotalStudents, reason }) =>
    api.post(`/attendance/${id}/corrections`, {
      proposed_absent_student_ids: proposedAbsentStudentIds,
      proposed_total_students: proposedTotalStudents,
      reason,
    }),
  listCorrections: (id) => api.get(`/attendance/${id}/corrections`),
  approveCorrection: (correctionId) => api.post(`/attendance/corrections/${correctionId}/approve`),
  rejectCorrection: (correctionId) => api.post(`/attendance/corrections/${correctionId}/reject`),
};
