import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { ApiError } from '@/api/client';
import { platformAdminApi } from '@/api/platform';

const PAGE_SIZE = 20;

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
];

function deriveStatus(invitation) {
  if (invitation.revoked_at) return 'revoked';
  if (invitation.accepted_at) return 'accepted';
  if (new Date(invitation.expires_at) <= new Date()) return 'expired';
  return 'pending';
}

const STATUS_VARIANT = {
  pending: 'warning',
  accepted: 'success',
  expired: 'outline',
  revoked: 'destructive',
};

function InvitationActions({ invitation }) {
  const queryClient = useQueryClient();
  const status = deriveStatus(invitation);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['platform', 'invitations'] });
    queryClient.invalidateQueries({ queryKey: ['platform', 'dashboard-summary'] });
  }

  const resendMutation = useMutation({
    mutationFn: () => platformAdminApi.resendInvitation(invitation.id),
    onSuccess: () => { toast.success('Invitation resent'); invalidate(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not resend invitation'),
  });

  const revokeMutation = useMutation({
    mutationFn: () => platformAdminApi.revokeInvitation(invitation.id),
    onSuccess: () => { toast.success('Invitation revoked'); invalidate(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not revoke invitation'),
  });

  if (status !== 'pending') return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" disabled={resendMutation.isPending} onClick={() => resendMutation.mutate()}>
        Resend
      </Button>
      <Button variant="outline" size="sm" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate()}>
        Revoke
      </Button>
    </div>
  );
}

export function InvitationsPage() {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform', 'invitations', { status, search, offset }],
    queryFn: () => platformAdminApi.listInvitations({
      limit: PAGE_SIZE, offset, status: status === 'all' ? undefined : status, search: search || undefined,
    }),
  });

  const invitations = data ?? [];

  return (
    <PageContainer>
      <PageHeader title="Invitations" description="Manage and track all invitations sent to colleges." />

      <Tabs value={status} onValueChange={(v) => { setStatus(v); setOffset(0); }} className="mb-4">
        <TabsList>
          {STATUS_TABS.map((tab) => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search invitations…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <div className="p-6"><Skeleton className="h-64 w-full" /></div>}
          {isError && <p className="p-6 text-sm text-destructive">Could not load invitations.</p>}
          {data && invitations.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">No invitations found.</p>
          )}
          {data && invitations.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invitee</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent On</TableHead>
                  <TableHead>Expires On</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium">{invitation.email}</TableCell>
                    <TableCell>{invitation.college_id}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[deriveStatus(invitation)]}>{deriveStatus(invitation)}</Badge>
                    </TableCell>
                    <TableCell>{new Date(invitation.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>{new Date(invitation.expires_at).toLocaleDateString()}</TableCell>
                    <TableCell><InvitationActions invitation={invitation} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && (invitations.length === PAGE_SIZE || offset > 0) && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={invitations.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
