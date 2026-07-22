import { platformApi } from './platformClient';

function toQueryString(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, value);
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export const platformAdminApi = {
  login: (username, password) => platformApi.post('/auth/login', { username, password }),
  createCollege: ({
    collegeId, name, subdomain, level1PositionTitle, level3PositionTitle, storageTier, license, principalEmail,
  }) => platformApi.post('/colleges', {
    college_id: collegeId,
    name,
    subdomain,
    level1_position_title: level1PositionTitle || undefined,
    level3_position_title: level3PositionTitle || undefined,
    storage_tier: storageTier || undefined,
    subscription_status: license || undefined,
    principal_email: principalEmail || undefined,
  }),
  updateCollege: (collegeId, {
    name, level1PositionTitle, level3PositionTitle, storageTier, license,
  }) => platformApi.patch(`/colleges/${collegeId}`, {
    name: name || undefined,
    level1_position_title: level1PositionTitle || undefined,
    level3_position_title: level3PositionTitle || undefined,
    storage_tier: storageTier || undefined,
    subscription_status: license || undefined,
  }),
  invitePrincipal: (collegeId, email) => platformApi.post(`/colleges/${collegeId}/invite-principal`, { email }),
  resendInvitation: (invitationId) => platformApi.post(`/invitations/${invitationId}/resend`),
  revokeInvitation: (invitationId) => platformApi.post(`/invitations/${invitationId}/revoke`),

  listColleges: ({ limit, offset, search } = {}) => platformApi.get(`/colleges${toQueryString({ limit, offset, search })}`),
  listInvitations: ({ limit, offset, status, search } = {}) => platformApi.get(`/invitations${toQueryString({ limit, offset, status, search })}`),
  listAuditLogs: ({
    limit, offset, action, actorAdminId, fromDate, toDate,
  } = {}) => platformApi.get(`/audit-logs${toQueryString({
    limit, offset, action, actor_admin_id: actorAdminId, from_date: fromDate, to_date: toDate,
  })}`),
  getSettings: () => platformApi.get('/settings'),
  updateSettings: ({
    platformName, supportEmail, defaultTimezone, dateFormat, itemsPerPage,
  }) => platformApi.put('/settings', {
    platform_name: platformName,
    support_email: supportEmail,
    default_timezone: defaultTimezone,
    date_format: dateFormat,
    items_per_page: itemsPerPage,
  }),
  getDashboardSummary: () => platformApi.get('/dashboard-summary'),
};
