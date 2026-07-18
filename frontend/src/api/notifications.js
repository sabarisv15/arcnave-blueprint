import { api } from './client';

export const notificationsApi = {
  list: () => api.get('/notifications'),
  draft: (payload) => api.post('/notifications', payload),
  submit: (id) => api.post(`/notifications/${id}/submit`),
};
