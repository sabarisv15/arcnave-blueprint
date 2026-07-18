import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { RoleGate } from '@/components/layout/RoleGate';
import { classesApi } from '@/api/classes';
import { timetablePeriodsApi } from '@/api/timetablePeriods';
import { facultyAllocationApi } from '@/api/facultyAllocation';
import { ApiError } from '@/api/client';
import { facultyAllocationFormSchema, substituteAssignmentFormSchema } from '@/features/academic/schemas';
import { ExaminationTab } from '@/features/academic/components/ExaminationTab';

function ProfileTab({ cls, id, navigate }) {
  const queryClient = useQueryClient();
  const [alertBody, setAlertBody] = useState('');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['classes', id] });
  }

  const submitMutation = useMutation({
    mutationFn: () => classesApi.submitForApproval(id),
    onSuccess: () => { invalidate(); toast.success('Submitted for HOD approval'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not submit for approval'),
  });
  const promoteMutation = useMutation({
    mutationFn: () => classesApi.promoteSemester(id),
    onSuccess: () => { invalidate(); toast.success('Semester promoted'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not promote semester'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => classesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      toast.success('Class removed');
      navigate('/academic');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove class'),
  });
  const alertMutation = useMutation({
    mutationFn: () => classesApi.sendAlert(id, alertBody),
    onSuccess: () => { toast.success('Alert sent'); setAlertBody(''); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not send alert'),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">{cls.class_name}</CardTitle>
            <CardDescription>
              {cls.department || 'No department'} · Semester {cls.semester || '—'} ·{' '}
              <Badge variant="secondary">{cls.timetable_status}</Badge>
            </CardDescription>
          </div>
          <RoleGate permission="classes.delete">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this class?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </RoleGate>
        </CardHeader>
        <CardFooter className="gap-2">
          <Button size="sm" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
            Submit timetable for approval
          </Button>
          <RoleGate permission="classes.promote_semester">
            <Button size="sm" variant="outline" onClick={() => promoteMutation.mutate()} disabled={promoteMutation.isPending}>
              Promote semester
            </Button>
          </RoleGate>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Send class alert</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input value={alertBody} onChange={(e) => setAlertBody(e.target.value)} placeholder="Alert message" />
          <Button size="sm" onClick={() => alertMutation.mutate()} disabled={!alertBody || alertMutation.isPending}>
            Send
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function FacultyAllocationTab({ id }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['faculty-allocation', 'class', id],
    queryFn: () => facultyAllocationApi.listForClass(id),
  });
  const { data: periods } = useQuery({
    queryKey: ['timetable-periods'],
    queryFn: () => timetablePeriodsApi.list({ limit: 100 }),
  });

  const form = useForm({
    resolver: zodResolver(facultyAllocationFormSchema),
    defaultValues: { periodId: '', subject: '', staffUserId: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values) => facultyAllocationApi.create({ classId: id, ...values }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faculty-allocation', 'class', id] });
      toast.success('Faculty allocated');
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not allocate faculty'),
  });
  const removeMutation = useMutation({
    mutationFn: (allocationId) => facultyAllocationApi.remove(allocationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faculty-allocation', 'class', id] });
      toast.success('Allocation removed');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove allocation'),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Faculty allocation</CardTitle>
        <RoleGate permission="faculty_allocation.create">
          {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Allocate</Button>}
        </RoleGate>
      </CardHeader>
      <CardContent className="space-y-3">
        {open && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="grid grid-cols-3 gap-2">
              <FormField control={form.control} name="periodId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Period ID</FormLabel>
                  <FormControl><Input {...field} placeholder={periods?.[0]?.id || ''} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="subject" render={({ field }) => (
                <FormItem><FormLabel>Subject</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="staffUserId" render={({ field }) => (
                <FormItem><FormLabel>Staff user ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="col-span-3 flex gap-2">
                <Button type="submit" size="sm" disabled={createMutation.isPending}>Save</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </Form>
        )}
        {isLoading && <Skeleton className="h-16 w-full" />}
        {data && data.length === 0 && <p className="text-sm text-muted-foreground">No allocations yet.</p>}
        {data && data.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
            <span>{a.subject} — staff {a.staff_user_id}</span>
            <RoleGate permission="faculty_allocation.delete">
              <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(a.id)}>Remove</Button>
            </RoleGate>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SubstituteAssignmentsTab({ id }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['classes', id, 'substitute-assignments'],
    queryFn: () => classesApi.listSubstituteAssignments(id),
  });
  const form = useForm({
    resolver: zodResolver(substituteAssignmentFormSchema),
    defaultValues: { timetablePeriodId: '', assignmentDate: '', originalStaffUserId: '', substituteStaffUserId: '', reason: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values) => classesApi.createSubstituteAssignment(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes', id, 'substitute-assignments'] });
      toast.success('Substitute assigned');
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not assign substitute'),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Substitute assignments</CardTitle>
        <RoleGate permission="substitute_assignments.create">
          {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>New assignment</Button>}
        </RoleGate>
      </CardHeader>
      <CardContent className="space-y-3">
        {open && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="grid grid-cols-2 gap-2">
              <FormField control={form.control} name="timetablePeriodId" render={({ field }) => (
                <FormItem><FormLabel>Period ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="assignmentDate" render={({ field }) => (
                <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="originalStaffUserId" render={({ field }) => (
                <FormItem><FormLabel>Original staff user ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="substituteStaffUserId" render={({ field }) => (
                <FormItem><FormLabel>Substitute staff user ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem className="col-span-2"><FormLabel>Reason</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="col-span-2 flex gap-2">
                <Button type="submit" size="sm" disabled={createMutation.isPending}>Save</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </Form>
        )}
        {isLoading && <Skeleton className="h-16 w-full" />}
        {data && data.length === 0 && <p className="text-sm text-muted-foreground">No substitute assignments.</p>}
        {data && data.map((sa) => (
          <div key={sa.id} className="rounded-md border p-2 text-sm">
            {sa.assignment_date} — {sa.reason}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TimetableTab({ id }) {
  const { data, isLoading } = useQuery({
    queryKey: ['classes', id, 'timetable-revisions'],
    queryFn: () => classesApi.listTimetableRevisions(id),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Timetable revisions</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {data && data.length === 0 && <p className="text-sm text-muted-foreground">No revisions yet.</p>}
        {data && data.map((rev) => (
          <div key={rev.id} className="rounded-md border p-2 text-sm">
            Effective from {rev.effective_from_date} {rev.effective_to_date ? `to ${rev.effective_to_date}` : '(current)'}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ClassDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: cls, isLoading, isError } = useQuery({
    queryKey: ['classes', id],
    queryFn: () => classesApi.get(id),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !cls) return <p className="text-sm text-destructive">Could not load this class.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/academic')}>&larr; Back to academic</Button>
        <h1 className="text-xl font-semibold">{cls.class_name}</h1>
      </div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="allocation">Faculty allocation</TabsTrigger>
          <TabsTrigger value="substitutes">Substitutes</TabsTrigger>
          <TabsTrigger value="timetable">Timetable</TabsTrigger>
          <TabsTrigger value="examination">Examination</TabsTrigger>
        </TabsList>
        <TabsContent value="profile"><ProfileTab cls={cls} id={id} navigate={navigate} /></TabsContent>
        <TabsContent value="allocation"><FacultyAllocationTab id={id} /></TabsContent>
        <TabsContent value="substitutes"><SubstituteAssignmentsTab id={id} /></TabsContent>
        <TabsContent value="timetable"><TimetableTab id={id} /></TabsContent>
        <TabsContent value="examination"><ExaminationTab id={id} /></TabsContent>
      </Tabs>
    </div>
  );
}
