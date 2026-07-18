import {
  getAccessToken, setAccessToken, getRefreshToken, setRefreshToken,
  getCollegeCode, clearSession,
} from '@/lib/authStorage';

export class ApiError extends Error {
  constructor(status, detail, body) {
    super(detail || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

const BASE_URL = '/api/v1';

let refreshPromise = null;

async function doRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new ApiError(401, 'No refresh token');
  const collegeCode = getCollegeCode();
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Without this, tenantMiddleware has no subdomain (dev host has
      // none) and no JWT claim (refresh sends no Authorization header)
      // to resolve a tenant from — the request silently loses RLS
      // scope and getRefreshTokenByHash finds no row, so a perfectly
      // valid refresh token 401s as "invalid". Confirmed against the
      // real backend: this call site was a bare fetch() that forgot
      // the header the shared request() function always attaches.
      ...(collegeCode ? { 'X-College-Code': collegeCode } : {}),
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    clearSession();
    throw new ApiError(res.status, 'Session expired');
  }
  const data = await res.json();
  setAccessToken(data.access_token);
  setRefreshToken(data.refresh_token);
  return data.access_token;
}

// Single flight: concurrent 401s trigger one refresh, not one per request.
function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request(path, { method = 'GET', body, headers = {}, isRetry = false, signal } = {}) {
  const token = getAccessToken();
  const collegeCode = getCollegeCode();

  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  if (collegeCode) finalHeaders['X-College-Code'] = collegeCode;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  // Only a 401 on a request that actually carried an access token means
  // "your session expired" — refresh-and-retry (then force a login
  // redirect if even that fails). A 401 with no token attached is a
  // public, unauthenticated endpoint rejecting the request for its own
  // reasons (bad MFA code, invalid/expired reset or invitation token,
  // wrong login credentials) and must be left alone: forcing a login
  // redirect here would hijack every public auth-flow error page,
  // confirmed against the real backend on /invitations/accept.
  if (res.status === 401 && !isRetry && token) {
    try {
      await refreshOnce();
      return request(path, { method, body, headers, isRetry: true, signal });
    } catch {
      window.location.assign('/login');
      throw new ApiError(401, 'Session expired');
    }
  }

  if (res.status === 204) return null;

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : await res.blob();

  if (!res.ok) {
    throw new ApiError(res.status, data && data.detail, data);
  }

  return data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

// Downloads need the Bearer header, so a plain <a href> won't work —
// fetch as a blob and trigger the save via an object URL.
export async function downloadFile(path, fallbackFileName) {
  const token = getAccessToken();
  const collegeCode = getCollegeCode();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(collegeCode ? { 'X-College-Code': collegeCode } : {}),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data && data.detail, data);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = (match && match[1]) || fallbackFileName || 'download';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// Same blob/filename handling as downloadFile, but for the one route
// (POST /documents/:id/merge) that streams file bytes back from a
// POST-with-body call instead of a plain GET.
export async function postForFile(path, body, fallbackFileName) {
  const token = getAccessToken();
  const collegeCode = getCollegeCode();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(collegeCode ? { 'X-College-Code': collegeCode } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data && data.detail, data);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = (match && match[1]) || fallbackFileName || 'download';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
