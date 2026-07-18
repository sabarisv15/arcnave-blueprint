import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { authApi } from '@/api/auth';
import { forgotPasswordSchema } from '@/features/auth/schemas';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  async function onSubmit(values) {
    setSubmitting(true);
    try {
      // Always 204 — enumeration-safe by design (authService never
      // reveals whether the email matched a real account). The UI
      // must show the same neutral message either way.
      await authApi.requestPasswordReset(values.email);
    } catch {
      // Swallowed deliberately: even a network-shaped failure here
      // shouldn't distinguish "account doesn't exist" from a real
      // error for an unauthenticated caller.
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>We&apos;ll email you a reset link if an account exists.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-muted-foreground">
              If that email is registered, a reset link has been sent.
            </p>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
