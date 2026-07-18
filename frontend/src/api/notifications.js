import { api } from './client';

// Mirrors backend/src/routes/notifications.js's NOTIFICATION_BODY_FIELDS
// exactly — that route reads snake_case keys off req.body (to_address,
// ...), not the camelCase names features/workflow's RHF form uses.
export const notificationsApi = {
  list: () => api.get('/notifications'),
  draft: ({ channel, toAddress, subject, body }) => api.post('/notifications', {
    channel, to_address: toAddress, subject, body,
  }),
  submit: (id) => api.post(`/notifications/${id}/submit`),
};
