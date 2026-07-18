import { api } from './client';

export const financeApi = {
  listFeeStructures: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/finance/fee-structures${qs ? `?${qs}` : ''}`);
  },
};
