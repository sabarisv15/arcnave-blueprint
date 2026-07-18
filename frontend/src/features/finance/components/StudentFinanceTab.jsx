import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { financeApi } from '@/api/finance';
import { ApiError } from '@/api/client';
import {
  feePaymentFormSchema, scholarshipDecisionFormSchema, FEE_PAYMENT_STATUSES,
} from '@/features/finance/schemas';

export function StudentFinanceTab({ studentId }) {
  const queryClient = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);

  const { data: payments, isLoading: paymentsLoading, isError: paymentsError } = useQuery({
    queryKey: ['finance', 'payments', studentId],
    queryFn: () => financeApi.listFeePaymentsForStudent(studentId),
  });
  const { data: eligibility } = useQuery({
    queryKey: ['finance', 'scholarship-eligibility', studentId],
    queryFn: () => financeApi.getScholarshipEligibility(studentId),
  });
  const { data: decisions } = useQuery({
    queryKey: ['finance', 'scholarship-decisions', studentId],
    queryFn: () => financeApi.listScholarshipDecisions(studentId),
  });

  const payForm = useForm({ resolver: zodResolver(feePaymentFormSchema), defaultValues: { feeStructureId: '', status: 'paid' } });
  const decisionForm = useForm({
    resolver: zodResolver(scholarshipDecisionFormSchema),
    defaultValues: { schemeName: '', eligible: 'true', reason: '' },
  });

  const payMutation = useMutation({
    mutationFn: (values) => financeApi.markFeePayment({ studentId, ...values }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'payments', studentId] });
      toast.success('Fee payment recorded');
      setPayOpen(false);
      payForm.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not record payment'),
  });
  const decisionMutation = useMutation({
    mutationFn: (values) => financeApi.recordScholarshipDecision(studentId, {
      ...values, eligible: values.eligible === 'true',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'scholarship-decisions', studentId] });
      toast.success('Scholarship decision recorded');
      decisionForm.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not record decision'),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Fee payments</CardTitle>
          <RoleGate permission="finance.fee_payments.create">
            {!payOpen && <Button size="sm" variant="outline" onClick={() => setPayOpen(true)}>Record payment</Button>}
          </RoleGate>
        </CardHeader>
        <CardContent className="space-y-3">
          {payOpen && (
            <Form {...payForm}>
              <form onSubmit={payForm.handleSubmit((v) => payMutation.mutateAsync(v))} className="flex items-end gap-2">
                <FormField control={payForm.control} name="feeStructureId" render={({ field }) => (
                  <FormItem><FormLabel>Fee structure ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={payForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {FEE_PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" size="sm" disabled={payMutation.isPending}>Save</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
              </form>
            </Form>
          )}
          {paymentsLoading && <Skeleton className="h-16 w-full" />}
          {paymentsError && <p className="text-sm text-destructive">Could not load payments.</p>}
          {payments && payments.length === 0 && <p className="text-sm text-muted-foreground">No payments recorded.</p>}
          {payments && payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span>Fee structure {p.fee_structure_id}</span>
              <Badge variant={p.status === 'paid' ? 'default' : 'outline'}>{p.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scholarship</CardTitle>
          <CardDescription>
            {eligibility
              // checkScholarshipEligibility returns a service-built
              // camelCase object (annualIncome/threshold/reason) —
              // unlike every other Finance route, which passes raw
              // snake_case DB rows straight through.
              ? `Eligibility (advisory): ${eligibility.eligible ? 'Eligible' : 'Not eligible'} (${eligibility.reason}) — annual income ${eligibility.annualIncome ?? '—'}, threshold ${eligibility.threshold ?? '—'}`
              : 'Eligibility not available.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* No dedicated permission entry for this — BusinessRules.md
              names the Class Tutor as the actor, enforced by
              financeService.recordScholarshipDecision's own
              tutor_user_id check (403 otherwise), not a role-name
              gate here. */}
          <Form {...decisionForm}>
            <form onSubmit={decisionForm.handleSubmit((v) => decisionMutation.mutateAsync(v))} className="grid grid-cols-3 gap-2">
              <FormField control={decisionForm.control} name="schemeName" render={({ field }) => (
                <FormItem><FormLabel>Scheme name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={decisionForm.control} name="eligible" render={({ field }) => (
                <FormItem>
                  <FormLabel>Decision</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="true">Eligible</SelectItem>
                      <SelectItem value="false">Not eligible</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={decisionForm.control} name="reason" render={({ field }) => (
                <FormItem><FormLabel>Reason</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="col-span-3">
                <Button type="submit" size="sm" disabled={decisionMutation.isPending}>Record decision</Button>
              </div>
            </form>
          </Form>
          {decisions && decisions.length === 0 && <p className="text-sm text-muted-foreground">No decisions recorded.</p>}
          {decisions && decisions.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span>{d.scheme_name} — {d.reason}</span>
              <Badge variant={d.eligible ? 'default' : 'outline'}>{d.eligible ? 'Eligible' : 'Not eligible'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
