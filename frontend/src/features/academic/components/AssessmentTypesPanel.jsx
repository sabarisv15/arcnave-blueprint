import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { assessmentsApi } from '@/api/assessments';
import { ApiError } from '@/api/client';
import { assessmentTypeFormSchema } from '@/features/academic/schemas';

export function AssessmentTypesPanel() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['assessment-types'],
    queryFn: () => assessmentsApi.listTypes({ limit: 100 }),
  });

  const form = useForm({ resolver: zodResolver(assessmentTypeFormSchema), defaultValues: { name: '', maxMarks: 100 } });

  const createMutation = useMutation({
    mutationFn: (values) => assessmentsApi.createType(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment-types'] });
      toast.success('Assessment type created');
      setCreateOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create assessment type'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RoleGate permission="assessment_types.create">
          <Button onClick={() => setCreateOpen(true)}>New assessment type</Button>
        </RoleGate>
      </div>
      {isLoading && <Skeleton className="h-48 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load assessment types.</p>}
      {data && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Max marks</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No assessment types yet.</TableCell></TableRow>
              )}
              {data.map((t) => (
                <TableRow key={t.id}><TableCell>{t.name}</TableCell><TableCell>{t.max_marks}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New assessment type</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="maxMarks" render={({ field }) => (
                <FormItem><FormLabel>Max marks</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
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
