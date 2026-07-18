import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/api/client';
import { mfaSchema } from '@/features/auth/schemas';

export function MfaChallengePage() {
  const { verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const challengeId = location.state?.challengeId;
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({ resolver: zodResolver(mfaSchema), defaultValues: { code: '' } });

  useEffect(() => {
    if (!challengeId) navigate('/login', { replace: true });
  }, [challengeId, navigate]);

  async function onSubmit(values) {
    setSubmitting(true);
    try {
      await verifyMfa(challengeId, values.code);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!challengeId) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Enter verification code</CardTitle>
          <CardDescription>Check your email for the code we sent.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" autoComplete="one-time-code" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify'}
              </Button>
            </CardContent>
          </form>
        </Form>
      </Card>
    </div>
  );
}
