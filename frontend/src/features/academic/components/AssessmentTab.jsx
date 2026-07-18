import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { assessmentsApi } from '@/api/assessments';
import { studentsApi } from '@/api/students';
import { ApiError } from '@/api/client';
import { assessmentMarkFormSchema } from '@/features/academic/schemas';

export function AssessmentTab({ id }) {
  const queryClient = useQueryClient();
  const { data: types } = useQuery({ queryKey: ['assessment-types'], queryFn: () => assessmentsApi.listTypes({ limit: 100 }) });
  const { data: allStudents } = useQuery({ queryKey: ['students', 'all-for-attendance'], queryFn: () => studentsApi.list({ limit: 200 }) });
  const classStudents = (allStudents || []).filter((s) => s.class_id === id);

  const { data: marks, isLoading, isError } = useQuery({
    queryKey: ['assessment-marks', 'class', id],
    queryFn: () => assessmentsApi.listMarks({ classId: id }),
  });

  const form = useForm({
    resolver: zodResolver(assessmentMarkFormSchema),
    defaultValues: { academicYear: '', subject: '', assessmentTypeId: '', studentId: '', marksObtained: '' },
  });

  const recordMutation = useMutation({
    mutationFn: (values) => assessmentsApi.recordMark(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment-marks', 'class', id] });
      toast.success('Mark recorded');
      form.reset({ academicYear: form.getValues('academicYear'), subject: form.getValues('subject'), assessmentTypeId: form.getValues('assessmentTypeId'), studentId: '', marksObtained: '' });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not record mark'),
  });
  const removeMutation = useMutation({
    mutationFn: (markId) => assessmentsApi.removeMark(markId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment-marks', 'class', id] });
      toast.success('Mark removed');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove mark'),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record assessment mark</CardTitle>
          <CardDescription>Only the subject's assigned faculty may record marks — enforced by the backend.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => recordMutation.mutateAsync(v))} className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="academicYear" render={({ field }) => (
                <FormItem><FormLabel>Academic year</FormLabel><FormControl><Input placeholder="2026-2027" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="subject" render={({ field }) => (
                <FormItem><FormLabel>Subject</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="assessmentTypeId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Assessment type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(types ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name} (max {t.max_marks})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="studentId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Student</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {classStudents.map((s) => <SelectItem key={s.id} value={s.id}>{s.roll_no} — {s.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="marksObtained" render={({ field }) => (
                <FormItem><FormLabel>Marks obtained</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="col-span-3">
                <Button type="submit" disabled={recordMutation.isPending}>Record mark</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recorded marks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <Skeleton className="h-16 w-full" />}
          {isError && <p className="text-sm text-destructive">Could not load marks.</p>}
          {marks && marks.length === 0 && <p className="text-sm text-muted-foreground">No marks recorded yet.</p>}
          {marks && marks.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span>{m.subject} — student {m.student_id} — {m.marks_obtained} marks ({m.academic_year})</span>
              <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(m.id)}>Remove</Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
