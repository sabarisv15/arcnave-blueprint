import { createContext, useContext, useCallback, useMemo, useState } from 'react';
import { platformAdminApi } from '@/api/platform';
import { setPlatformAccessToken, clearPlatformSession } from '@/lib/platformAuthStorage';

const PlatformAuthContext = createContext(null);

export function PlatformAuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = useCallback(async (username, password) => {
    const result = await platformAdminApi.login(username, password);
    setPlatformAccessToken(result.access_token);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    clearPlatformSession();
    setIsAuthenticated(false);
  }, []);

  const value = useMemo(() => ({ isAuthenticated, login, logout }), [isAuthenticated, login, logout]);

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth() {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used within PlatformAuthProvider');
  return ctx;
}
