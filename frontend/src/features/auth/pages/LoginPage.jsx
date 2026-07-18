import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter,
} from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { useAuth } from '@/hooks/useAuth';
import { setCollegeCode, getCollegeCode } from '@/lib/authStorage';
import { ApiError } from '@/api/client';
import { loginSchema } from '@/features/auth/schemas';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { collegeCode: getCollegeCode() || '', username: '', password: '' },
  });

  async function onSubmit(values) {
    setSubmitting(true);
    try {
      setCollegeCode(values.collegeCode);
      const result = await login(values.username, values.password);
      if (result.mfaRequired) {
        navigate('/login/mfa', { state: { challengeId: result.challengeId } });
        return;
      }
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to ARCNAVE</CardTitle>
          <CardDescription>Enter your college code and credentials.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="collegeCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>College code</FormLabel>
                    <FormControl>
                      <Input autoComplete="organization" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input autoComplete="username" {...field} />
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
              <a href="/forgot-password" className="text-center text-sm text-muted-foreground hover:underline">
                Forgot password?
              </a>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
