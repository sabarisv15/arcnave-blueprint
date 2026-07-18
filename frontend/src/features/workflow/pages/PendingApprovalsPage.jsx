import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { workflowRequestsApi } from '@/api/workflowRequests';
import { ApiError } from '@/api/client';
import { workflowActionFormSchema } from '@/features/workflow/schemas';

function PendingRequestCard({ request }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(null); // 'approve' | 'reject' | null

  const form = useForm({ resolver: zodResolver(workflowActionFormSchema), defaultValues: { remarks: '' } });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['workflow-requests', 'pending'] });
  }

  const approveMutation = useMutation({
    mutationFn: (values) => workflowRequestsApi.approve(request.id, values.remarks || undefined),
    onSuccess: () => { invalidate(); toast.success('Approved'); setOpen(null); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not approve'),
  });
  const rejectMutation = useMutation({
    mutationFn: (values) => workflowRequestsApi.reject(request.id, values.remarks || undefined),
    onSuccess: () => { invalidate(); toast.success('Rejected'); setOpen(null); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not reject'),
  });

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{request.entity_type}</div>
          <div className="text-muted-foreground">Entity {request.entity_id}</div>
        </div>
        <Badge variant="secondary">Step {request.current_step}</Badge>
      </div>
      {!open && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen('approve')}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => setOpen('reject')}>Reject</Button>
        </div>
      )}
      {open && (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => (open === 'approve' ? approveMutation.mutateAsync(v) : rejectMutation.mutateAsync(v)))}
            className="flex items-end gap-2"
          >
            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem><FormLabel>Remarks</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" size="sm" disabled={approveMutation.isPending || rejectMutation.isPending}>
              Confirm {open}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
          </form>
        </Form>
      )}
    </div>
  );
}

export function PendingApprovalsPage() {
  const { data: pending, isLoading, isError } = useQuery({
    queryKey: ['workflow-requests', 'pending'],
    queryFn: () => workflowRequestsApi.listPending(),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Pending approvals</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waiting on you</CardTitle>
          <CardDescription>Requests where you are the resolved approver for the current step.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <Skeleton className="h-16 w-full" />}
          {isError && <p className="text-sm text-destructive">Could not load pending approvals.</p>}
          {pending && pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending.</p>}
          {pending && pending.map((request) => <PendingRequestCard key={request.id} request={request} />)}
        </CardContent>
      </Card>
    </div>
  );
}
