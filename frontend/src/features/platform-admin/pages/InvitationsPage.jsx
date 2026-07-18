import { useState } from 'react';
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
import { platformAdminApi } from '@/api/platform';
import { invitationActionFormSchema } from '@/features/platform-admin/schemas';

function InvitationActionCard({ title, description, action, successMessage }) {
  const [result, setResult] = useState(null);
  const form = useForm({ resolver: zodResolver(invitationActionFormSchema), defaultValues: { invitationId: '' } });

  const mutation = useMutation({
    mutationFn: (values) => action(values.invitationId),
    onSuccess: (data) => { setResult(data); toast.success(successMessage); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : `Could not ${title.toLowerCase()}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutateAsync(v))} className="flex items-end gap-2">
            <FormField control={form.control} name="invitationId" render={({ field }) => (
              <FormItem><FormLabel>Invitation ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" size="sm" disabled={mutation.isPending}>{title}</Button>
          </form>
        </Form>
        {result && (
          <p className="text-xs text-muted-foreground">
            {result.college_id} · {result.email} — {result.expires_at ? `expires ${result.expires_at}` : `revoked ${result.revoked_at}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function InvitationsPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Invitations</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate('/platform/colleges')}>Colleges</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        No list endpoint yet — act on an invitation ID from the Colleges page's own invite response.
      </p>
      <InvitationActionCard
        title="Resend"
        description="Rotates the token and re-sends the invitation email."
        action={platformAdminApi.resendInvitation}
        successMessage="Invitation resent"
      />
      <InvitationActionCard
        title="Revoke"
        description="Invalidates the invitation — it can no longer be accepted."
        action={platformAdminApi.revokeInvitation}
        successMessage="Invitation revoked"
      />
    </div>
  );
}
