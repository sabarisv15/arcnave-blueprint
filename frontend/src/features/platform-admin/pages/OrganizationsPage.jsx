import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { ApiError } from '@/api/client';
import { platformAdminApi } from '@/api/platform';
import { invitePrincipalFormSchema, editCollegeFormSchema, LICENSE_OPTIONS } from '@/features/platform-admin/schemas';

const PAGE_SIZE = 20;

function InvitePrincipalDialog({ college, open, onOpenChange }) {
  const queryClient = useQueryClient();
  const form = useForm({ resolver: zodResolver(invitePrincipalFormSchema), defaultValues: { email: '' } });

  const inviteMutation = useMutation({
    mutationFn: (values) => platformAdminApi.invitePrincipal(college.college_id, values.email),
    onSuccess: () => {
      toast.success(`Principal invited to ${college.name}`);
      form.reset();
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['platform', 'invitations'] });
      queryClient.invalidateQueries({ queryKey: ['platform', 'dashboard-summary'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not invite principal'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Principal</DialogTitle>
          <DialogDescription>Send a principal invitation for {college?.name}.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => inviteMutation.mutateAsync(v))} className="space-y-4">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>Principal email</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? 'Sending…' : 'Send invite'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditCollegeDialog({ college, open, onOpenChange }) {
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(editCollegeFormSchema),
    defaultValues: {
      name: '', level1PositionTitle: '', level3PositionTitle: '', storageTier: '', license: 'trial',
    },
  });

  // Re-prefill whenever a different college is opened for editing —
  // the dialog instance persists across opens (mounted once by
  // OrganizationsPage below), so defaultValues alone only applies on
  // first mount.
  useEffect(() => {
    if (college) {
      form.reset({
        name: college.name || '',
        level1PositionTitle: college.level1_position_title || '',
        level3PositionTitle: college.level3_position_title || '',
        storageTier: college.storage_tier || '',
        license: college.subscription_status || 'trial',
      });
    }
  }, [college, form]);

  const updateMutation = useMutation({
    mutationFn: (values) => platformAdminApi.updateCollege(college.college_id, values),
    onSuccess: () => {
      toast.success(`${college.name} updated`);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['platform', 'colleges'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not update college'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Organization</DialogTitle>
          <DialogDescription>
            College Code and Subdomain can&apos;t be changed here — everything else can.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => updateMutation.mutateAsync(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Organization Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="license" render={({ field }) => (
              <FormItem>
                <FormLabel>License</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {LICENSE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{option === 'trial' ? 'Trial' : 'Full'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="level1PositionTitle" render={({ field }) => (
              <FormItem><FormLabel>Level 1 Position Title (optional)</FormLabel><FormControl><Input placeholder="e.g. Principal, Director" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="level3PositionTitle" render={({ field }) => (
              <FormItem><FormLabel>Level 3 (HOD) Position Title (optional)</FormLabel><FormControl><Input placeholder="e.g. HOD, Head of Section" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="storageTier" render={({ field }) => (
              <FormItem><FormLabel>Storage Tier (optional)</FormLabel><FormControl><Input placeholder="e.g. 5 GB" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function OrganizationsPage() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [inviteTarget, setInviteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform', 'colleges', { offset, search }],
    queryFn: () => platformAdminApi.listColleges({ limit: PAGE_SIZE, offset, search: search || undefined }),
  });

  const colleges = data ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Organizations"
        description="Manage all colleges and organizations on the platform."
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search organizations…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <div className="p-6"><Skeleton className="h-64 w-full" /></div>}
          {isError && <p className="p-6 text-sm text-destructive">Could not load organizations.</p>}
          {data && colleges.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">No organizations found.</p>
          )}
          {data && colleges.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>College Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Created On</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {colleges.map((college) => (
                  <TableRow key={college.college_id}>
                    <TableCell>
                      <div className="font-medium">{college.name}</div>
                      <div className="text-xs text-muted-foreground">{college.subdomain}.arcnave.com</div>
                    </TableCell>
                    <TableCell>{college.college_id}</TableCell>
                    <TableCell>
                      <Badge variant={college.subscription_status === 'trial' ? 'outline' : 'success'}>
                        {college.subscription_status}
                      </Badge>
                      {college.last_sync_status === 'error' && (
                        <Badge variant="destructive" className="ml-1">sync error</Badge>
                      )}
                    </TableCell>
                    <TableCell>{college.active_users_count ?? '—'}</TableCell>
                    <TableCell>{new Date(college.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditTarget(college)}>
                        Edit
                      </Button>
                      {' '}
                      <Button variant="outline" size="sm" onClick={() => setInviteTarget(college)}>
                        Invite Principal
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && (colleges.length === PAGE_SIZE || offset > 0) && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={colleges.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
        </div>
      )}

      <InvitePrincipalDialog
        college={inviteTarget}
        open={Boolean(inviteTarget)}
        onOpenChange={(open) => !open && setInviteTarget(null)}
      />
      <EditCollegeDialog
        college={editTarget}
        open={Boolean(editTarget)}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />
    </PageContainer>
  );
}
