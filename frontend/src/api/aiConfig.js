import { api } from './client';

export const aiConfigApi = {
  get: () => api.get('/ai-config'),
  update: ({ provider, apiKey, model, embeddingModel, baseUrl }) => api.put('/ai-config', {
    provider, api_key: apiKey, model, embedding_model: embeddingModel, base_url: baseUrl,
  }),
};
