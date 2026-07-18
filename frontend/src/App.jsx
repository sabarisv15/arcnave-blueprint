import { useEffect, useRef, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { router } from '@/app/routes';
import { useAuth } from '@/hooks/useAuth';
import { Toaster } from '@/components/ui/sonner';

function AuthBootstrap({ children }) {
  const { restoreSession } = useAuth();
  const [ready, setReady] = useState(false);
  const hasRun = useRef(false);

  useEffect(() => {
    // Refresh tokens are single-use server-side (authService.refresh
    // revokes-and-rotates on every call) — a second concurrent call
    // with the same stored token races the first and can 401. React
    // 18 StrictMode double-invokes this effect in dev, so without this
    // guard restoreSession() fired twice on every mount, verified
    // against the real backend during Authentication testing.
    if (hasRun.current) return;
    hasRun.current = true;
    restoreSession().finally(() => setReady(true));
  }, [restoreSession]);

  if (!ready) return null;
  return children;
}

function AppInner() {
  return (
    <AuthBootstrap>
      <RouterProvider router={router} />
    </AuthBootstrap>
  );
}

export default function App() {
  return (
    <AppProviders>
      <AppInner />
      <Toaster />
    </AppProviders>
  );
}
