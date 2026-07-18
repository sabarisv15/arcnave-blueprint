import { api } from './client';

export const invitationsApi = {
  accept: (token, username, password) => api.post('/invitations/accept', { token, username, password }),
};
