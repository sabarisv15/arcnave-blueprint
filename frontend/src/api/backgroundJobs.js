import { api } from './client';

export const backgroundJobsApi = {
  list: () => api.get('/background-jobs'),
  get: (id) => api.get(`/background-jobs/${id}`),
};
