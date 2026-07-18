import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { curriculumApi } from '@/api/curriculum';
import { ApiError } from '@/api/client';
import { regulationFormSchema, subjectFormSchema } from '@/features/academic/schemas';

function SubjectsList({ regulationId }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['regulations', regulationId, 'subjects'],
    queryFn: () => curriculumApi.listSubjects(regulationId),
  });
  const form = useForm({
    resolver: zodResolver(subjectFormSchema),
    defaultValues: { subjectCode: '', subjectName: '', semester: 1, credits: '', lectureHours: '', tutorialHours: '', practicalHours: '', subjectType: '' },
  });

  const createMutation = useMutation({
    // Blank optional numeric fields must be omitted, not sent as '' —
    // same lesson learned in Staff (typed columns reject '').
    mutationFn: (values) => {
      const payload = { ...values };
      for (const key of Object.keys(payload)) {
        if (payload[key] === '') delete payload[key];
      }
      return curriculumApi.createSubject(regulationId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulations', regulationId, 'subjects'] });
      toast.success('Subject added');
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not add subject'),
  });
  const removeMutation = useMutation({
    mutationFn: (id) => curriculumApi.removeSubject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulations', regulationId, 'subjects'] });
      toast.success('Subject removed');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove subject'),
  });

  return (
    <div className="space-y-2 pl-4">
      {isLoading && <Skeleton className="h-8 w-full" />}
      {data && data.length === 0 && <p className="text-sm text-muted-foreground">No subjects yet.</p>}
      {data && data.map((subject) => (
        <div key={subject.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
          <span>{subject.subject_code} — {subject.subject_name} ({subject.credits ?? '—'} credits)</span>
          <RoleGate permission="subjects.delete">
            <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(subject.id)}>Remove</Button>
          </RoleGate>
        </div>
      ))}
      <RoleGate permission="subjects.create">
        {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Add subject</Button>}
        {open && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="grid grid-cols-2 gap-2 rounded-md border p-3">
              <FormField control={form.control} name="subjectCode" render={({ field }) => (
                <FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="subjectName" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="semester" render={({ field }) => (
                <FormItem><FormLabel>Semester</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="credits" render={({ field }) => (
                <FormItem><FormLabel>Credits</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="col-span-2 flex gap-2">
                <Button type="submit" size="sm" disabled={createMutation.isPending}>Save</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </Form>
        )}
      </RoleGate>
    </div>
  );
}

export function CurriculumPanel() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['regulations'],
    queryFn: () => curriculumApi.listRegulations(),
  });

  const form = useForm({ resolver: zodResolver(regulationFormSchema), defaultValues: { name: '', description: '' } });

  const createMutation = useMutation({
    mutationFn: (values) => curriculumApi.createRegulation(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulations'] });
      toast.success('Regulation created');
      setCreateOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create regulation'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RoleGate permission="regulations.create">
          <Button onClick={() => setCreateOpen(true)}>New regulation</Button>
        </RoleGate>
      </div>
      {isLoading && <Skeleton className="h-48 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load regulations.</p>}
      {data && data.length === 0 && <p className="text-sm text-muted-foreground">No regulations yet.</p>}
      {data && data.map((reg) => (
        <Card key={reg.id}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {reg.name} <Badge variant="outline" className="ml-2">{reg.description || 'No description'}</Badge>
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === reg.id ? null : reg.id)}>
              {expanded === reg.id ? 'Hide subjects' : 'Show subjects'}
            </Button>
          </CardHeader>
          {expanded === reg.id && (
            <CardContent>
              <SubjectsList regulationId={reg.id} />
            </CardContent>
          )}
        </Card>
      ))}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New regulation</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
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
