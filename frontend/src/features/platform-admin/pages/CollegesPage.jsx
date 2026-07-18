import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { ApiError } from '@/api/client';
import { platformAdminApi } from '@/api/platform';
import { usePlatformAuth } from '@/hooks/usePlatformAuth';
import { collegeFormSchema, invitePrincipalFormSchema } from '@/features/platform-admin/schemas';

function InvitePrincipalRow({ college }) {
  const [open, setOpen] = useState(false);
  const [lastInvitation, setLastInvitation] = useState(null);
  const form = useForm({ resolver: zodResolver(invitePrincipalFormSchema), defaultValues: { email: '' } });

  const inviteMutation = useMutation({
    mutationFn: (values) => platformAdminApi.invitePrincipal(college.college_id, values.email),
    onSuccess: (invitation) => {
      setLastInvitation(invitation);
      toast.success('Principal invited');
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not invite principal'),
  });

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{college.name}</div>
          <div className="text-muted-foreground">{college.college_id} · {college.subdomain}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{college.subscription_status}</Badge>
          {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Invite principal</Button>}
        </div>
      </div>
      {open && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => inviteMutation.mutateAsync(v))} className="flex items-end gap-2">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>Principal email</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" size="sm" disabled={inviteMutation.isPending}>Send invite</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </form>
        </Form>
      )}
      {lastInvitation && (
        <p className="text-xs text-muted-foreground">
          Invitation {lastInvitation.invitation_id} sent to {lastInvitation.email}, expires {lastInvitation.expires_at}.
        </p>
      )}
    </div>
  );
}

export function CollegesPage() {
  const navigate = useNavigate();
  const { logout } = usePlatformAuth();
  const [colleges, setColleges] = useState([]);

  const form = useForm({
    resolver: zodResolver(collegeFormSchema),
    defaultValues: { collegeId: '', name: '', subdomain: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values) => platformAdminApi.createCollege(values),
    onSuccess: (college) => {
      setColleges((prev) => [college, ...prev]);
      toast.success('College created');
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create college'),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Colleges</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/platform/invitations')}>Invitations</Button>
          <Button variant="outline" size="sm" onClick={() => { logout(); navigate('/platform/login'); }}>Logout</Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New college</CardTitle>
          <CardDescription>Onboards a new tenant. Colleges created this session are listed below — there is no list endpoint yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="grid grid-cols-3 gap-2">
              <FormField control={form.control} name="collegeId" render={({ field }) => (
                <FormItem><FormLabel>College ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="subdomain" render={({ field }) => (
                <FormItem><FormLabel>Subdomain</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="col-span-3">
                <Button type="submit" size="sm" disabled={createMutation.isPending}>Create</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Created this session</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {colleges.length === 0 && <p className="text-sm text-muted-foreground">No colleges created yet.</p>}
          {colleges.map((college) => <InvitePrincipalRow key={college.college_id} college={college} />)}
        </CardContent>
      </Card>
    </div>
  );
}
