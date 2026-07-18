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
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { financeApi } from '@/api/finance';
import { ApiError } from '@/api/client';
import { feeStructureFormSchema } from '@/features/finance/schemas';

export function FinancePage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['fee-structures'],
    queryFn: () => financeApi.listFeeStructures({ limit: 100 }),
  });

  const form = useForm({
    resolver: zodResolver(feeStructureFormSchema),
    defaultValues: { academicYear: '', classId: '', feeCategory: '', amount: '', remarks: '' },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['fee-structures'] });
  }

  const createMutation = useMutation({
    // Blank optional fields must be omitted, not sent as '' — same
    // lesson learned in Staff/Academic (typed columns reject '').
    mutationFn: (values) => {
      const payload = { ...values };
      for (const key of Object.keys(payload)) {
        if (payload[key] === '') delete payload[key];
      }
      return financeApi.createFeeStructure(payload);
    },
    onSuccess: () => { invalidate(); toast.success('Fee structure created'); setCreateOpen(false); form.reset(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create fee structure'),
  });
  const submitMutation = useMutation({
    mutationFn: (id) => financeApi.submitFeeStructureApproval(id),
    onSuccess: () => { invalidate(); toast.success('Submitted for approval'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not submit for approval'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Finance</h1>
        <RoleGate permission="finance.fee_structures.create">
          <Button onClick={() => setCreateOpen(true)}>New fee structure</Button>
        </RoleGate>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load fee structures.</p>}
      {data && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Academic year</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No fee structures yet.</TableCell></TableRow>
              )}
              {data.map((fs) => (
                <TableRow key={fs.id}>
                  <TableCell>{fs.academic_year}</TableCell>
                  <TableCell>{fs.class_id}</TableCell>
                  <TableCell>{fs.fee_category}</TableCell>
                  <TableCell>{fs.amount}</TableCell>
                  <TableCell><Badge variant="secondary">{fs.status}</Badge></TableCell>
                  <TableCell>
                    {fs.status === 'Pending Approval' && (
                      <Button size="sm" variant="outline" onClick={() => submitMutation.mutate(fs.id)} disabled={submitMutation.isPending}>
                        Submit for approval
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New fee structure</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="space-y-4">
              <FormField control={form.control} name="academicYear" render={({ field }) => (
                <FormItem><FormLabel>Academic year</FormLabel><FormControl><Input placeholder="2026-2027" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="classId" render={({ field }) => (
                <FormItem><FormLabel>Class ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="feeCategory" render={({ field }) => (
                <FormItem><FormLabel>Fee category</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="remarks" render={({ field }) => (
                <FormItem><FormLabel>Remarks</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
