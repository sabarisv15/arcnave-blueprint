import { api } from './client';

export const workflowRequestsApi = {
  listPending: () => api.get('/workflow-requests/pending'),
  approve: (id, remarks) => api.post(`/workflow-requests/${id}/approve`, { remarks }),
  reject: (id, remarks) => api.post(`/workflow-requests/${id}/reject`, { remarks }),
};
