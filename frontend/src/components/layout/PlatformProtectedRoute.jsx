import { Navigate, Outlet } from 'react-router-dom';
import { usePlatformAuth } from '@/hooks/usePlatformAuth';

export function PlatformProtectedRoute() {
  const { isAuthenticated } = usePlatformAuth();

  if (!isAuthenticated) {
    return <Navigate to="/platform/login" replace />;
  }
  return <Outlet />;
}
