import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { ApiError } from '@/api/client';
import { usePlatformAuth } from '@/hooks/usePlatformAuth';
import { platformLoginFormSchema } from '@/features/platform-admin/schemas';

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const { login } = usePlatformAuth();
  const form = useForm({ resolver: zodResolver(platformLoginFormSchema), defaultValues: { username: '', password: '' } });

  const loginMutation = useMutation({
    mutationFn: (values) => login(values.username, values.password),
    onSuccess: () => navigate('/platform/dashboard'),
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Invalid username or password'),
  });

  return (
    <div
      className="relative flex h-screen items-center justify-center overflow-hidden p-6"
      style={{
        background: 'linear-gradient(160deg, #001824 0%, #004961 35%, #0088b0 70%, #1186ac 100%)',
        color: '#f3f2f2',
        fontFamily: "'Baloo 2', system-ui, sans-serif",
      }}
    >
      {/* soft glow blobs */}
      <div className="pointer-events-none absolute inset-0 opacity-20">
        <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full" style={{ background: '#ff458e' }} />
        <div className="absolute -bottom-28 -right-16 h-80 w-80 rounded-full" style={{ background: '#62c5ee' }} />
        <div className="absolute left-1/2 top-[38%] h-44 w-44 -translate-x-1/2 rounded-full" style={{ background: '#edbb00' }} />
      </div>

      {/* floating campus icons */}
      <div
        className="pointer-events-none absolute inset-0 hidden opacity-30 sm:block"
        style={{ filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.25))' }}
      >
        <div className="absolute left-[7%] top-[10%] animate-[arc-float_7s_ease-in-out_infinite]" style={{ '--r': '-6deg' }}>
          <div className="h-24 w-[150px] rounded-t-lg p-2" style={{ background: '#38a6cf' }}>
            <div className="h-full w-full rounded" style={{ background: '#f3f2f2' }} />
          </div>
          <div className="h-2.5 rounded-b-md" style={{ width: 176, background: '#ff458e', margin: '0 -13px' }} />
        </div>

        <div className="absolute bottom-[9%] left-[9%] animate-[arc-float-slow_6s_ease-in-out_infinite]">
          <div className="h-5 rounded" style={{ width: 150, background: '#00c2e0' }} />
          <div className="mt-[3px] h-5 rounded" style={{ width: 170, background: '#ff2f8f' }} />
          <div className="mt-[3px] h-[22px] rounded" style={{ width: 190, background: '#ffcf33' }} />
        </div>

        <div className="absolute right-[8%] top-[12%] animate-[arc-float_8s_ease-in-out_infinite_0.4s]" style={{ '--r': '5deg' }}>
          <div
            className="rounded-md p-3.5"
            style={{ width: 170, height: 110, background: '#aa0b56', border: '8px solid #00c2e0', boxSizing: 'border-box' }}
          >
            <div className="mb-3 h-[3px] rounded" style={{ width: '70%', background: '#f3f2f2' }} />
            <div className="h-[3px] rounded" style={{ width: '50%', background: '#f3f2f2' }} />
          </div>
        </div>

        <div className="absolute bottom-[6%] right-[2%] animate-[arc-float_7.5s_ease-in-out_infinite_0.2s]" style={{ '--r': '6deg' }}>
          <div className="rounded-lg p-4" style={{ width: 100, height: 120, background: '#00c2e0', boxSizing: 'border-box' }}>
            <div className="mb-3.5 h-[3px] rounded" style={{ background: '#004961' }} />
            <div className="mb-3.5 h-[3px] rounded" style={{ width: '70%', background: '#004961' }} />
            <div className="h-[3px] rounded" style={{ width: '85%', background: '#004961' }} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes arc-float { 0%,100% { transform: translateY(0) rotate(var(--r,0deg)) scale(1); } 50% { transform: translateY(-18px) rotate(var(--r,0deg)) scale(1.03); } }
        @keyframes arc-float-slow { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-22px) scale(1.02); } }
      `}</style>

      <div
        className="relative z-10 w-full max-w-[420px] rounded-[20px] px-10 py-11"
        style={{
          background: 'rgba(243,242,242,0.97)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          color: '#201e1d',
        }}
      >
        <div className="mb-1.5 text-center">
          <div
            className="text-[22px] font-extrabold tracking-wide"
            style={{ fontFamily: "'Baloo 2', sans-serif", color: '#004961' }}
          >
            ARCNAVE AI CAMPUS OS
          </div>
        </div>
        <h2
          className="mb-1.5 mt-3.5 text-center text-2xl font-bold leading-tight"
          style={{ fontFamily: "'Baloo 2', sans-serif", color: '#201e1d' }}
        >
          Platform admin sign in
        </h2>
        <p className="mb-6 text-center text-sm font-medium" style={{ color: 'rgba(32,30,29,0.65)' }}>
          Super Admin console — separate from tenant college accounts.
        </p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => loginMutation.mutateAsync(v))} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel style={{ color: 'rgba(32,30,29,0.7)' }}>Username</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="username"
                      placeholder="platform_admin"
                      className="rounded-xl border-[#20191b29] bg-[#eae9e9] text-[#201e1d]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel style={{ color: 'rgba(32,30,29,0.7)' }}>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="rounded-xl border-[#20191b29] bg-[#eae9e9] text-[#201e1d]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={loginMutation.isPending}
              className="mt-1.5 w-full rounded-2xl py-6 text-base font-bold"
              style={{ fontFamily: "'Baloo 2', sans-serif", background: '#0088b0', color: '#f3f2f2' }}
            >
              {loginMutation.isPending ? 'Signing in…' : 'Login'}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
