import { api } from './client';

export const archivalApi = {
  list: (entityType) => api.get(`/archived-records${entityType ? `?entity_type=${entityType}` : ''}`),
  archive: ({ entityType, entityId, reason }) => api.post('/archived-records', {
    entity_type: entityType, entity_id: entityId, reason,
  }),
  requestRestoration: (id, reason) => api.post(`/archived-records/${id}/request-restoration`, { reason }),
  approveRestoration: (id) => api.post(`/archived-records/${id}/approve-restoration`),
  rejectRestoration: (id) => api.post(`/archived-records/${id}/reject-restoration`),
};
