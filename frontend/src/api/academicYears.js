import { api } from './client';

export const academicYearsApi = {
  list: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/academic-years${qs ? `?${qs}` : ''}`);
  },
  getActive: () => api.get('/academic-years/active'),
  get: (id) => api.get(`/academic-years/${id}`),
  create: ({ yearLabel, startDate, endDate }) =>
    api.post('/academic-years', { year_label: yearLabel, start_date: startDate, end_date: endDate }),
  activate: (id) => api.post(`/academic-years/${id}/activate`),
  close: (id) => api.post(`/academic-years/${id}/close`),
  archive: (id) => api.post(`/academic-years/${id}/archive`),
};
