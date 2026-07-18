import { useAuth } from '@/hooks/useAuth';

// Hides children the current role has no permission for. This is a
// UX nicety only — the backend's requirePermission is the real gate;
// this just avoids showing controls that would 403.
export function RoleGate({ permission, children, fallback = null }) {
  const { can } = useAuth();
  return can(permission) ? children : fallback;
}
