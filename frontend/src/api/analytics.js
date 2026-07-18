import { api } from './client';

export const analyticsApi = {
  attendanceRate: ({ classId, startDate, endDate } = {}) => {
    const params = new URLSearchParams();
    if (classId) params.set('class_id', classId);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const qs = params.toString();
    return api.get(`/analytics/attendance-rate${qs ? `?${qs}` : ''}`);
  },
};
