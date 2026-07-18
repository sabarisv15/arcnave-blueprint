import { api } from './client';

export const aiApi = {
  listTools: () => api.get('/ai/tools'),
  invokeTool: (name, params, question) => api.post(`/ai/tools/${name}/invoke`, {
    params, ...(question ? { question } : {}),
  }),
  ask: (question) => api.post('/ai/ask', { question }),
};
