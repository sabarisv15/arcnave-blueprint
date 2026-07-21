import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { classesApi } from '@/api/classes';
import { ApiError } from '@/api/client';
import { classFormSchema } from '@/features/academic/schemas';

export function ClassesPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.list({ limit: 100 }),
  });

  const form = useForm({
    resolver: zodResolver(classFormSchema),
    defaultValues: { className: '', department: '', departmentId: '', semester: '' },
  });

  const createMutation = useMutation({
    // Blank optional fields must be omitted, not sent as '' — same
    // lesson as StaffFormDialog: departmentId is a typed uuid column
    // server-side and rejects ''. Class Tutor is assigned separately,
    // from the class detail page (ClassDetailPage's ProfileTab) —
    // createClass/updateClass reject tutorUserId outright now.
    mutationFn: (values) => {
      const payload = { ...values };
      for (const key of Object.keys(payload)) {
        if (payload[key] === '') delete payload[key];
      }
      return classesApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      toast.success('Class created');
      setCreateOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create class'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RoleGate permission="classes.create">
          <Button onClick={() => setCreateOpen(true)}>New class</Button>
        </RoleGate>
      </div>
      {isLoading && <Skeleton className="h-48 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load classes.</p>}
      {data && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Semester</TableHead>
                <TableHead>Timetable status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No classes yet.</TableCell></TableRow>
              )}
              {data.map((cls) => (
                <TableRow key={cls.id} className="cursor-pointer" onClick={() => navigate(`/academic/classes/${cls.id}`)}>
                  <TableCell>{cls.class_name}</TableCell>
                  <TableCell>{cls.department || '—'}</TableCell>
                  <TableCell>{cls.semester || '—'}</TableCell>
                  <TableCell><Badge variant="secondary">{cls.timetable_status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New class</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="space-y-4">
              <FormField control={form.control} name="className" render={({ field }) => (
                <FormItem><FormLabel>Class name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="department" render={({ field }) => (
                <FormItem><FormLabel>Department</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="semester" render={({ field }) => (
                <FormItem><FormLabel>Semester</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
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
