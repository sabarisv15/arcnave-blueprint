import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { reportsApi } from '@/api/reports';
import { documentsApi } from '@/api/documents';
import { ApiError } from '@/api/client';
import { REPORT_FORMATS, simpleReportFormSchema, assessmentMarksReportFormSchema } from '@/features/reports/schemas';

function ReportResult({ report }) {
  if (!report) return null;
  return (
    <div className="flex items-center justify-between rounded-md border p-3 text-sm">
      <div>
        <div className="font-medium">{report.report_type} · {report.format}</div>
        {report.status === 'failed' && <div className="text-destructive">{report.error_message}</div>}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={report.status === 'completed' ? 'default' : 'destructive'}>{report.status}</Badge>
        {report.status === 'completed' && report.document_id && (
          <Button size="sm" variant="outline" onClick={() => documentsApi.download(report.document_id, `${report.report_type}.${report.format}`)}>
            Download
          </Button>
        )}
      </div>
    </div>
  );
}

function SimpleReportCard({ title, description, generate, reportType }) {
  const [result, setResult] = useState(null);
  const form = useForm({ resolver: zodResolver(simpleReportFormSchema), defaultValues: { format: 'csv' } });

  const mutation = useMutation({
    mutationFn: (values) => generate(values.format),
    onSuccess: (report) => {
      setResult(report);
      if (report.status === 'completed') toast.success('Report generated');
      else toast.error(report.error_message || 'Report generation failed');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not generate report'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutateAsync(v))} className="flex items-end gap-2">
            <FormField control={form.control} name="format" render={({ field }) => (
              <FormItem>
                <FormLabel>Format</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger className="w-28"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {REPORT_FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" size="sm" disabled={mutation.isPending}>Generate</Button>
          </form>
        </Form>
        <ReportResult report={result} key={reportType} />
      </CardContent>
    </Card>
  );
}

function AssessmentMarksReportCard() {
  const [result, setResult] = useState(null);
  const form = useForm({
    resolver: zodResolver(assessmentMarksReportFormSchema),
    defaultValues: {
      format: 'csv', academicYear: '', departmentId: '', classId: '', subject: '', assessmentTypeId: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values) => {
      const payload = { ...values };
      for (const key of Object.keys(payload)) {
        if (payload[key] === '') delete payload[key];
      }
      return reportsApi.generateAssessmentMarks(payload);
    },
    onSuccess: (report) => {
      setResult(report);
      if (report.status === 'completed') toast.success('Report generated');
      else toast.error(report.error_message || 'Report generation failed');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not generate report'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assessment marks</CardTitle>
        <CardDescription>Filters are optional — leave blank to export everything within the row limit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutateAsync(v))} className="grid grid-cols-3 gap-2">
            <FormField control={form.control} name="academicYear" render={({ field }) => (
              <FormItem><FormLabel>Academic year</FormLabel><FormControl><Input placeholder="2026-2027" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="departmentId" render={({ field }) => (
              <FormItem><FormLabel>Department ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="classId" render={({ field }) => (
              <FormItem><FormLabel>Class ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="subject" render={({ field }) => (
              <FormItem><FormLabel>Subject</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="assessmentTypeId" render={({ field }) => (
              <FormItem><FormLabel>Assessment type ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="format" render={({ field }) => (
              <FormItem>
                <FormLabel>Format</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {REPORT_FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="col-span-3">
              <Button type="submit" size="sm" disabled={mutation.isPending}>Generate</Button>
            </div>
          </form>
        </Form>
        <ReportResult report={result} />
      </CardContent>
    </Card>
  );
}

export function ReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <p className="text-sm text-muted-foreground">
        Each generate is a fresh export — recent generations aren&apos;t re-listed after leaving this page.
      </p>
      <SimpleReportCard
        title="Student export"
        description="All students, current tenant."
        generate={reportsApi.generateStudentExport}
        reportType="student_export"
      />
      <SimpleReportCard
        title="Attendance report"
        description="All attendance sessions."
        generate={reportsApi.generateAttendance}
        reportType="attendance_report"
      />
      <SimpleReportCard
        title="Finance report"
        description="Fee structures and payments."
        generate={reportsApi.generateFinance}
        reportType="finance_report"
      />
      <AssessmentMarksReportCard />
    </div>
  );
}
