// Platform admin is a structurally separate auth domain from the
// tenant app (CLAUDE.md / routes.jsx's own comment) — its own token,
// never mixed with authStorage.js's tenant accessToken. No refresh
// token: platformService issues no refresh for platform admins
// (routes/platform.js's own comment) — re-authenticate on expiry
// instead. In-memory only, same XSS-blast-radius reasoning
// authStorage.js's tenant accessToken already uses.
let accessToken = null;

export function getPlatformAccessToken() {
  return accessToken;
}

export function setPlatformAccessToken(token) {
  accessToken = token;
}

export function clearPlatformSession() {
  accessToken = null;
}
