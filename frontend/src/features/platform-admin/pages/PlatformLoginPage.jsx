import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
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
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Platform admin sign in</CardTitle>
          <CardDescription>Super Admin console — separate from tenant college accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => loginMutation.mutateAsync(v))} className="space-y-4">
              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem><FormLabel>Username</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={loginMutation.isPending}>Sign in</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
