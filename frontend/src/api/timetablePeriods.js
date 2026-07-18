import { api } from './client';

export const timetablePeriodsApi = {
  list: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/timetable-periods${qs ? `?${qs}` : ''}`);
  },
  get: (id) => api.get(`/timetable-periods/${id}`),
  create: ({ dayOfWeek, hourIndex, startTime, endTime }) => api.post('/timetable-periods', {
    day_of_week: dayOfWeek, hour_index: hourIndex, start_time: startTime, end_time: endTime,
  }),
  remove: (id) => api.delete(`/timetable-periods/${id}`),
};
