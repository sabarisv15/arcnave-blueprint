import { api } from './client';

export const documentCategoriesApi = {
  list: () => api.get('/document-categories'),
  create: (name) => api.post('/document-categories', { name }),
};
