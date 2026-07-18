import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { classesApi } from '@/api/classes';
import { studentsApi } from '@/api/students';
import { attendanceApi } from '@/api/attendance';
import { ApiError } from '@/api/client';
import { markAttendanceSchema, correctionRequestSchema } from '@/features/attendance/schemas';

function MarkAttendanceCard({ classId, students }) {
  const queryClient = useQueryClient();
  const [absentIds, setAbsentIds] = useState(new Set());

  const form = useForm({
    resolver: zodResolver(markAttendanceSchema),
    defaultValues: { classId, sessionDate: new Date().toISOString().slice(0, 10), hourIndex: 1, totalStudents: students.length || 1 },
  });

  const markMutation = useMutation({
    mutationFn: (values) => attendanceApi.mark({ ...values, classId, absentStudentIds: Array.from(absentIds) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-sessions', classId] });
      toast.success('Attendance marked');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not mark attendance'),
  });

  function toggleAbsent(studentId) {
    setAbsentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId); else next.add(studentId);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Mark attendance</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => markMutation.mutateAsync(v))} className="grid grid-cols-3 gap-3">
            <FormField control={form.control} name="sessionDate" render={({ field }) => (
              <FormItem><FormLabel>Session date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="hourIndex" render={({ field }) => (
              <FormItem><FormLabel>Hour index</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="totalStudents" render={({ field }) => (
              <FormItem><FormLabel>Total students</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="col-span-3 space-y-2">
              <p className="text-sm text-muted-foreground">Check students who are absent:</p>
              {students.length === 0 && <p className="text-sm text-muted-foreground">No students found for this class.</p>}
              <div className="grid grid-cols-2 gap-1">
                {students.map((s) => (
                  // Checkbox renders as a <button>, which is a labelable
                  // element — nesting it inside a <label> double-fires
                  // the toggle (once from the direct click, once from
                  // the label's native click-forwarding), always
                  // cancelling back to unchecked. Siblings, not
                  // parent/child, same fix shadcn's own docs use.
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`absent-${s.id}`}
                      checked={absentIds.has(s.id)}
                      onCheckedChange={() => toggleAbsent(s.id)}
                    />
                    <label htmlFor={`absent-${s.id}`}>{s.roll_no} — {s.full_name}</label>
                  </div>
                ))}
              </div>
            </div>
            <div className="col-span-3">
              <Button type="submit" disabled={markMutation.isPending}>Mark attendance</Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function SessionRow({ session }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: corrections } = useQuery({
    queryKey: ['attendance', session.id, 'corrections'],
    queryFn: () => attendanceApi.listCorrections(session.id),
    enabled: open,
  });
  const form = useForm({
    resolver: zodResolver(correctionRequestSchema),
    defaultValues: { proposedTotalStudents: session.total_students, reason: '' },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['attendance', session.id, 'corrections'] });
  }

  const lockMutation = useMutation({
    mutationFn: () => attendanceApi.lock(session.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-sessions', session.class_id] });
      toast.success('Session locked');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not lock session'),
  });
  const correctionMutation = useMutation({
    mutationFn: (values) => attendanceApi.requestCorrection(session.id, {
      proposedAbsentStudentIds: session.absent_student_ids || [],
      proposedTotalStudents: values.proposedTotalStudents,
      reason: values.reason,
    }),
    onSuccess: () => { invalidate(); toast.success('Correction requested'); form.reset(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not request correction'),
  });
  const approveMutation = useMutation({
    mutationFn: (correctionId) => attendanceApi.approveCorrection(correctionId),
    onSuccess: () => { invalidate(); toast.success('Correction approved'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not approve correction'),
  });
  const rejectMutation = useMutation({
    mutationFn: (correctionId) => attendanceApi.rejectCorrection(correctionId),
    onSuccess: () => { invalidate(); toast.success('Correction rejected'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not reject correction'),
  });

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          {session.session_date} · Hour {session.hour_index} · {session.total_students - (session.absent_student_ids?.length || 0)}/{session.total_students} present
          {' '}<Badge variant={session.locked_at ? 'secondary' : 'outline'}>{session.locked_at ? 'Locked' : 'Unlocked'}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</Button>
          <RoleGate permission="attendance.lock">
            {!session.locked_at && (
              <Button size="sm" variant="outline" onClick={() => lockMutation.mutate()} disabled={lockMutation.isPending}>Lock</Button>
            )}
          </RoleGate>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t pt-3">
          {/* attendanceService.requestAttendanceCorrection requires a
              locked session (409 otherwise) — an unlocked session is
              edited directly via re-marking, not a correction request. */}
          {!session.locked_at && (
            <p className="text-sm text-muted-foreground">
              This session isn&apos;t locked yet — re-mark attendance directly instead of requesting a correction.
            </p>
          )}
          {session.locked_at && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => correctionMutation.mutateAsync(v))} className="flex items-end gap-2">
              <FormField control={form.control} name="proposedTotalStudents" render={({ field }) => (
                <FormItem><FormLabel>Proposed total</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem className="flex-1"><FormLabel>Reason</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Button type="submit" size="sm" disabled={correctionMutation.isPending}>Request correction</Button>
            </form>
          </Form>
          )}
          {corrections && corrections.length === 0 && <p className="text-muted-foreground">No corrections requested.</p>}
          {corrections && corrections.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border p-2">
              <span>{c.reason} — proposed total {c.proposed_total_students}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => approveMutation.mutate(c.id)}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate(c.id)}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AttendancePage() {
  const [classId, setClassId] = useState('');
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => classesApi.list({ limit: 100 }) });
  const { data: allStudents } = useQuery({ queryKey: ['students', 'all-for-attendance'], queryFn: () => studentsApi.list({ limit: 200 }) });
  const classStudents = useMemo(
    () => (allStudents || []).filter((s) => s.class_id === classId),
    [allStudents, classId],
  );

  const { data: sessions, isLoading: sessionsLoading, isError: sessionsError } = useQuery({
    queryKey: ['attendance-sessions', classId],
    queryFn: () => attendanceApi.listForClass(classId),
    enabled: Boolean(classId),
  });

  const selectedClass = classes?.find((c) => c.id === classId);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Attendance</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select class</CardTitle>
          <CardDescription>Attendance marking is locked behind an Approved timetable.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Select a class" /></SelectTrigger>
            <SelectContent>
              {(classes ?? []).map((cls) => (
                <SelectItem key={cls.id} value={cls.id}>{cls.class_name} ({cls.timetable_status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {classId && selectedClass && selectedClass.timetable_status !== 'Approved' && (
        <p className="text-sm text-destructive">
          This class's timetable is {selectedClass.timetable_status}, not Approved — marking will be rejected server-side.
        </p>
      )}

      {classId && <MarkAttendanceCard classId={classId} students={classStudents} />}

      {classId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Sessions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {sessionsLoading && <Skeleton className="h-24 w-full" />}
            {sessionsError && <p className="text-sm text-destructive">Could not load sessions.</p>}
            {sessions && sessions.length === 0 && <p className="text-sm text-muted-foreground">No sessions yet.</p>}
            {sessions && sessions.map((session) => <SessionRow key={session.id} session={session} />)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
