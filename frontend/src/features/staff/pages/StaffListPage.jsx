import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { RoleGate } from '@/components/layout/RoleGate';
import { staffApi } from '@/api/staff';
import { ApiError } from '@/api/client';
import { StaffFormDialog } from '@/features/staff/components/StaffFormDialog';
import { HodAccountFormDialog } from '@/features/staff/components/HodAccountFormDialog';

const PAGE_SIZE = 20;

export function StaffListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [hodOpen, setHodOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['staff', { offset }],
    queryFn: () => staffApi.list({ limit: PAGE_SIZE, offset }),
  });

  const createMutation = useMutation({
    mutationFn: staffApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Staff profile created');
      setCreateOpen(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create staff profile'),
  });

  const hodMutation = useMutation({
    mutationFn: staffApi.createHodAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('HOD account created');
      setHodOpen(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create HOD account'),
  });

  const staff = data ?? [];
  const filtered = search
    ? staff.filter((s) => s.full_name.toLowerCase().includes(search.toLowerCase()))
    : staff;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Staff</h1>
        <div className="flex gap-2">
          <RoleGate permission="staff.hod_accounts.create">
            <Button variant="outline" onClick={() => setHodOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              New HOD account
            </Button>
          </RoleGate>
          <RoleGate permission="staff.create">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New staff profile
            </Button>
          </RoleGate>
        </div>
      </div>

      <Input
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading && <Skeleton className="h-64 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load staff.</p>}

      {data && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Phone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No staff found.</TableCell></TableRow>
              )}
              {filtered.map((member) => (
                <TableRow
                  key={member.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/staff/${member.id}`)}
                >
                  <TableCell>{member.staff_code || '—'}</TableCell>
                  <TableCell>{member.full_name}</TableCell>
                  <TableCell>{member.designation || '—'}</TableCell>
                  <TableCell>{member.phone || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </Button>
        <Button variant="outline" disabled={!data || data.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next
        </Button>
      </div>

      <StaffFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New staff profile"
        submitting={createMutation.isPending}
        onSubmit={(values) => createMutation.mutateAsync(values)}
      />
      <HodAccountFormDialog
        open={hodOpen}
        onOpenChange={setHodOpen}
        submitting={hodMutation.isPending}
        onSubmit={(values) => hodMutation.mutateAsync(values)}
      />
    </div>
  );
}
