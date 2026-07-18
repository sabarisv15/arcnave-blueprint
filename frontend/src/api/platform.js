import { platformApi } from './platformClient';

export const platformAdminApi = {
  login: (username, password) => platformApi.post('/auth/login', { username, password }),
  createCollege: ({ collegeId, name, subdomain }) => platformApi.post('/colleges', {
    college_id: collegeId, name, subdomain,
  }),
  invitePrincipal: (collegeId, email) => platformApi.post(`/colleges/${collegeId}/invite-principal`, { email }),
  resendInvitation: (invitationId) => platformApi.post(`/invitations/${invitationId}/resend`),
  revokeInvitation: (invitationId) => platformApi.post(`/invitations/${invitationId}/revoke`),
};
