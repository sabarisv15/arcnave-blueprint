import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { RoleGate } from '@/components/layout/RoleGate';
import { studentsApi } from '@/api/students';
import { ApiError } from '@/api/client';
import { StudentFormDialog } from '@/features/students/components/StudentFormDialog';
import {
  LIFECYCLE_STATUSES, APPROVAL_REQUIRED_STATUSES, lifecycleChangeSchema,
  transferRequestSchema, phoneOtpRequestSchema, phoneOtpVerifySchema,
} from '@/features/students/schemas';

function useStudentQuery(id) {
  return useQuery({ queryKey: ['students', id], queryFn: () => studentsApi.get(id) });
}

function ProfileTab({ student, id, navigate }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (values) => studentsApi.update(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', id] });
      toast.success('Student updated');
      setEditOpen(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not update student'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => studentsApi.remove(id),
    onSuccess: () => {
      toast.success('Student removed');
      navigate('/students');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove student'),
  });

  const fields = [
    ['Roll number', student.roll_no],
    ['Full name', student.full_name],
    ['Gender', student.gender],
    ['Entry type', student.entry_type],
    ['Email', student.email],
    ['Phone', student.phone],
    ['Parent name', student.parent_name],
    ['Parent phone', student.parent_phone],
    ['Address', student.address],
    ['Pincode', student.pincode],
    ['Annual income', student.annual_income],
    ['Notes', student.notes],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Profile</CardTitle>
        <div className="flex gap-2">
          <RoleGate permission="students.update">
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>Edit</Button>
          </RoleGate>
          <RoleGate permission="students.delete">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this student?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </RoleGate>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        {fields.map(([label, value]) => (
          <div key={label}>
            <div className="text-muted-foreground">{label}</div>
            <div>{value || '—'}</div>
          </div>
        ))}
      </CardContent>
      <StudentFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit student"
        submitting={updateMutation.isPending}
        initialValues={{
          rollNo: student.roll_no, fullName: student.full_name, gender: student.gender || '',
          entryType: student.entry_type || '', email: student.email || '', phone: student.phone || '',
          parentName: student.parent_name || '', parentPhone: student.parent_phone || '',
          address: student.address || '', pincode: student.pincode || '',
          annualIncome: student.annual_income ?? '', notes: student.notes || '',
        }}
        onSubmit={(values) => updateMutation.mutateAsync(values)}
      />
    </Card>
  );
}

function LifecycleTab({ student, id }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const form = useForm({
    resolver: zodResolver(lifecycleChangeSchema),
    defaultValues: { newStatus: 'Active', reason: '', effectiveDate: '' },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['students', id] });
  }

  const directMutation = useMutation({
    mutationFn: (values) => studentsApi.changeLifecycleStatus(id, values),
    onSuccess: () => { invalidate(); toast.success('Lifecycle status updated'); setOpen(false); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not update status'),
  });
  const requestMutation = useMutation({
    mutationFn: (values) => studentsApi.requestLifecycleStatusChange(id, values),
    onSuccess: () => { invalidate(); toast.success('Status change requested — pending approval'); setOpen(false); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not request status change'),
  });
  const approveMutation = useMutation({
    mutationFn: () => studentsApi.approveLifecycleStatusChange(id, {}),
    onSuccess: () => { invalidate(); toast.success('Status change approved'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not approve'),
  });
  const rejectMutation = useMutation({
    mutationFn: () => studentsApi.rejectLifecycleStatusChange(id),
    onSuccess: () => { invalidate(); toast.success('Status change rejected'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not reject'),
  });

  async function onSubmit(values) {
    const payload = { ...values };
    if (!payload.effectiveDate) delete payload.effectiveDate;
    if (APPROVAL_REQUIRED_STATUSES.includes(values.newStatus)) {
      await requestMutation.mutateAsync(payload);
    } else {
      await directMutation.mutateAsync(payload);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lifecycle status</CardTitle>
        <CardDescription>
          Current: <Badge variant="secondary">{student.lifecycle_status}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {student.pending_lifecycle_status && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <p>
              Pending change to <strong>{student.pending_lifecycle_status}</strong>
              {student.pending_lifecycle_reason ? ` — ${student.pending_lifecycle_reason}` : ''}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>Approve</Button>
              <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>Reject</Button>
            </div>
          </div>
        )}
        {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Change status</Button>}
        {open && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField control={form.control} name="newStatus" render={({ field }) => (
                <FormItem>
                  <FormLabel>New status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {LIFECYCLE_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}{APPROVAL_REQUIRED_STATUSES.includes(status) ? ' (requires approval)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={directMutation.isPending || requestMutation.isPending}>Submit</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}

function TransferTab({ id }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['students', id, 'transfer-requests'],
    queryFn: () => studentsApi.listTransferRequests(id),
  });

  const form = useForm({
    resolver: zodResolver(transferRequestSchema),
    defaultValues: { transferType: 'internal', destinationClassId: '', reason: '' },
  });
  const transferType = form.watch('transferType');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['students', id, 'transfer-requests'] });
  }

  const createMutation = useMutation({
    mutationFn: (values) => studentsApi.createTransferRequest(id, {
      transfer_type: values.transferType,
      destination_class_id: values.destinationClassId,
      destination_college_id: values.destinationCollegeId,
      reason: values.reason,
    }),
    onSuccess: () => { invalidate(); toast.success('Transfer requested'); setOpen(false); form.reset(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not request transfer'),
  });
  const approveMutation = useMutation({
    mutationFn: (transferRequestId) => studentsApi.approveTransferRequest(id, transferRequestId),
    onSuccess: () => { invalidate(); toast.success('Transfer approved'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not approve transfer'),
  });
  const rejectMutation = useMutation({
    mutationFn: (transferRequestId) => studentsApi.rejectTransferRequest(id, transferRequestId),
    onSuccess: () => { invalidate(); toast.success('Transfer rejected'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not reject transfer'),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Transfer requests</CardTitle>
        {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>New request</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        {open && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="space-y-3">
              <FormField control={form.control} name="transferType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="internal">Internal (same college)</SelectItem>
                      <SelectItem value="inter_college">Inter-college</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              {transferType === 'internal' ? (
                <FormField control={form.control} name="destinationClassId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destination class ID</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ) : (
                <FormField control={form.control} name="destinationCollegeId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destination college code</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={createMutation.isPending}>Submit</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </Form>
        )}
        {isLoading && <Skeleton className="h-16 w-full" />}
        {data && data.length === 0 && <p className="text-sm text-muted-foreground">No transfer requests.</p>}
        {data && data.map((tr) => (
          <div key={tr.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
            <div>
              <div>{tr.transfer_type} — {tr.reason}</div>
              {/* studentTransferRequests carries no status column of its
                  own (see studentService.approveStudentTransfer/
                  rejectStudentTransfer) — applied_at is set on approve,
                  left null on reject, so this can't distinguish
                  "pending" from "rejected". Approve/Reject stay
                  available either way; the backend's own
                  WorkflowRequestAlreadyResolvedError is the real gate
                  against acting twice, not this label. */}
              <Badge variant="secondary">{tr.applied_at ? 'Applied' : 'Pending or resolved'}</Badge>
            </div>
            {!tr.applied_at && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => approveMutation.mutate(tr.id)}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate(tr.id)}>Reject</Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PhoneVerificationTab({ student, id }) {
  const queryClient = useQueryClient();

  const otpForm = useForm({ resolver: zodResolver(phoneOtpRequestSchema), defaultValues: { target: 'phone' } });
  const verifyForm = useForm({ resolver: zodResolver(phoneOtpVerifySchema), defaultValues: { target: 'phone', code: '' } });

  const requestMutation = useMutation({
    mutationFn: (values) => studentsApi.requestPhoneOtp(id, values.target),
    onSuccess: () => toast.success('OTP sent'),
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not send OTP'),
  });
  const verifyMutation = useMutation({
    mutationFn: (values) => studentsApi.verifyPhoneOtp(id, values.target, values.code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', id] });
      toast.success('Phone verified');
      verifyForm.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Verification failed'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Phone verification</CardTitle>
        <CardDescription>
          Student phone: {student.phone_verified ? <Badge>Verified</Badge> : <Badge variant="outline">Not verified</Badge>}
          {' · '}
          Parent phone: {student.parent_phone_verified ? <Badge>Verified</Badge> : <Badge variant="outline">Not verified</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Form {...otpForm}>
          <form onSubmit={otpForm.handleSubmit((v) => requestMutation.mutateAsync(v))} className="space-y-3">
            <FormField control={otpForm.control} name="target" render={({ field }) => (
              <FormItem>
                <FormLabel>Send OTP to</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="phone">Student phone</SelectItem>
                    <SelectItem value="parent_phone">Parent phone</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" size="sm" disabled={requestMutation.isPending}>Send OTP</Button>
          </form>
        </Form>
        <Form {...verifyForm}>
          <form onSubmit={verifyForm.handleSubmit((v) => verifyMutation.mutateAsync(v))} className="space-y-3">
            <FormField control={verifyForm.control} name="target" render={({ field }) => (
              <FormItem>
                <FormLabel>Verify</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="phone">Student phone</SelectItem>
                    <SelectItem value="parent_phone">Parent phone</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={verifyForm.control} name="code" render={({ field }) => (
              <FormItem>
                <FormLabel>Code</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" size="sm" disabled={verifyMutation.isPending}>Verify</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export function StudentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: student, isLoading, isError } = useStudentQuery(id);

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !student) return <p className="text-sm text-destructive">Could not load this student.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/students')}>&larr; Back to students</Button>
          <h1 className="text-xl font-semibold">{student.full_name}</h1>
          <p className="text-sm text-muted-foreground">Roll No {student.roll_no}</p>
        </div>
      </div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
          <TabsTrigger value="transfer">Transfer</TabsTrigger>
          <TabsTrigger value="phone">Phone verification</TabsTrigger>
        </TabsList>
        <TabsContent value="profile"><ProfileTab student={student} id={id} navigate={navigate} /></TabsContent>
        <TabsContent value="lifecycle"><LifecycleTab student={student} id={id} /></TabsContent>
        <TabsContent value="transfer"><TransferTab id={id} /></TabsContent>
        <TabsContent value="phone"><PhoneVerificationTab student={student} id={id} /></TabsContent>
      </Tabs>
    </div>
  );
}
