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
import { academicYearsApi } from '@/api/academicYears';
import { ApiError } from '@/api/client';
import { academicYearFormSchema } from '@/features/academic/schemas';

export function AcademicYearsPanel() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list(),
  });

  const form = useForm({
    resolver: zodResolver(academicYearFormSchema),
    defaultValues: { yearLabel: '', startDate: '', endDate: '' },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['academic-years'] });
  }

  const createMutation = useMutation({
    mutationFn: (values) => academicYearsApi.create(values),
    onSuccess: () => { invalidate(); toast.success('Academic year created'); setCreateOpen(false); form.reset(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create academic year'),
  });
  const activateMutation = useMutation({
    mutationFn: (id) => academicYearsApi.activate(id),
    onSuccess: () => { invalidate(); toast.success('Academic year activated'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not activate'),
  });
  const closeMutation = useMutation({
    mutationFn: (id) => academicYearsApi.close(id),
    onSuccess: () => { invalidate(); toast.success('Academic year closed'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not close'),
  });
  const archiveMutation = useMutation({
    mutationFn: (id) => academicYearsApi.archive(id),
    onSuccess: () => { invalidate(); toast.success('Academic year archived'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not archive'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RoleGate permission="academic_years.create">
          <Button onClick={() => setCreateOpen(true)}>New academic year</Button>
        </RoleGate>
      </div>
      {isLoading && <Skeleton className="h-48 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load academic years.</p>}
      {data && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No academic years yet.</TableCell></TableRow>
              )}
              {data.map((year) => (
                <TableRow key={year.id}>
                  <TableCell>{year.year_label}</TableCell>
                  <TableCell>{year.start_date}</TableCell>
                  <TableCell>{year.end_date}</TableCell>
                  <TableCell><Badge variant="secondary">{year.status}</Badge></TableCell>
                  <TableCell>
                    <RoleGate permission="academic_years.activate">
                      <div className="flex gap-1">
                        {year.status === 'Draft' && (
                          <Button size="sm" variant="outline" onClick={() => activateMutation.mutate(year.id)}>Activate</Button>
                        )}
                        {year.status === 'Active' && (
                          <Button size="sm" variant="outline" onClick={() => closeMutation.mutate(year.id)}>Close</Button>
                        )}
                        {year.status === 'Closed' && (
                          <Button size="sm" variant="outline" onClick={() => archiveMutation.mutate(year.id)}>Archive</Button>
                        )}
                      </div>
                    </RoleGate>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New academic year</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="space-y-4">
              <FormField control={form.control} name="yearLabel" render={({ field }) => (
                <FormItem>
                  <FormLabel>Year label</FormLabel>
                  <FormControl><Input placeholder="2026-2027" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="startDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Start date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="endDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>End date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
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
