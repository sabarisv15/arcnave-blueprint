import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import { PlatformAuthProvider } from '@/hooks/usePlatformAuth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function AppProviders({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PlatformAuthProvider>{children}</PlatformAuthProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
