import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { archivalApi } from '@/api/archival';
import { ApiError } from '@/api/client';
import { archiveRecordFormSchema, restorationRequestFormSchema } from '@/features/academic/schemas';

function RestorationRow({ record }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(restorationRequestFormSchema), defaultValues: { reason: '' } });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['archived-records'] });
  }

  const requestMutation = useMutation({
    mutationFn: (values) => archivalApi.requestRestoration(record.id, values.reason || undefined),
    onSuccess: () => { invalidate(); toast.success('Restoration requested'); setOpen(false); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not request restoration'),
  });
  const approveMutation = useMutation({
    mutationFn: () => archivalApi.approveRestoration(record.id),
    onSuccess: () => { invalidate(); toast.success('Restoration approved'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not approve restoration'),
  });
  const rejectMutation = useMutation({
    mutationFn: () => archivalApi.rejectRestoration(record.id),
    onSuccess: () => { invalidate(); toast.success('Restoration rejected'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not reject restoration'),
  });

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{record.entity_type} — {record.entity_id}</div>
          {record.reason && <div className="text-muted-foreground">{record.reason}</div>}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={record.restored_at ? 'default' : 'secondary'}>
            {record.restored_at ? 'Restored' : record.workflow_request_id ? 'Restoration pending' : 'Archived'}
          </Badge>
          {!record.restored_at && !record.workflow_request_id && !open && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Request restoration</Button>
          )}
          {!record.restored_at && record.workflow_request_id && (
            <>
              <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>Approve</Button>
              <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>Reject</Button>
            </>
          )}
        </div>
      </div>
      {open && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => requestMutation.mutateAsync(v))} className="flex items-end gap-2">
            <FormField control={form.control} name="reason" render={({ field }) => (
              <FormItem><FormLabel>Reason</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" size="sm" disabled={requestMutation.isPending}>Submit</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </form>
        </Form>
      )}
    </div>
  );
}

export function ArchivalPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['archived-records', entityTypeFilter],
    queryFn: () => archivalApi.list(entityTypeFilter || undefined),
  });

  const form = useForm({
    resolver: zodResolver(archiveRecordFormSchema),
    defaultValues: { entityType: '', entityId: '', reason: '' },
  });

  const archiveMutation = useMutation({
    mutationFn: (values) => {
      const payload = { ...values };
      if (!payload.reason) delete payload.reason;
      return archivalApi.archive(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['archived-records'] });
      toast.success('Record archived');
      setCreateOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not archive record'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Archival</h1>
        <RoleGate permission="archived_records.create">
          <Button onClick={() => setCreateOpen(true)}>Archive a record</Button>
        </RoleGate>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Archived records</CardTitle>
          <CardDescription>Restoration follows the institution's approval workflow.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Filter by entity type</label>
            <Input value={entityTypeFilter} onChange={(e) => setEntityTypeFilter(e.target.value)} className="w-56" />
          </div>
          {isLoading && <Skeleton className="h-64 w-full" />}
          {isError && <p className="text-sm text-destructive">Could not load archived records.</p>}
          {data && data.length === 0 && <p className="text-sm text-muted-foreground">No archived records.</p>}
          {data && data.map((record) => <RestorationRow key={record.id} record={record} />)}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Archive a record</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => archiveMutation.mutateAsync(v))} className="space-y-4">
              <FormField control={form.control} name="entityType" render={({ field }) => (
                <FormItem><FormLabel>Entity type</FormLabel><FormControl><Input placeholder="e.g. student, staff" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="entityId" render={({ field }) => (
                <FormItem><FormLabel>Entity ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem><FormLabel>Reason</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={archiveMutation.isPending}>Archive</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
