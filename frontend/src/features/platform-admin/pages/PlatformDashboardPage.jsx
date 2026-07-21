import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Users, Mail, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { ApiError } from '@/api/client';
import { platformAdminApi } from '@/api/platform';
import { collegeFormSchema } from '@/features/platform-admin/schemas';

function StatCard({ icon: Icon, label, value, isLoading }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          {isLoading ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-bold leading-none">{value}</div>}
          <div className="mt-1 text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// Identity-Migration-Plan.md Phase 4 — read-only visibility into
// whether NEW_COLLEGE_ONBOARDING_ENABLED is set on the backend. The
// flag itself isn't a form field here (there's nothing for an admin to
// toggle per-request — see platformService.getSettings' own comment):
// it's an environment-level rollout switch, so this just tells the
// admin what will happen when they invite a principal for a college
// created through this form. With the flag off, the old bare-Principal
// flow is completely unaffected.
function useNewOnboardingFlag() {
  const { data } = useQuery({
    queryKey: ['platform', 'settings'],
    queryFn: () => platformAdminApi.getSettings(),
  });
  return Boolean(data?.new_college_onboarding_enabled);
}

function CreateCollegeCard() {
  const queryClient = useQueryClient();
  const newOnboardingEnabled = useNewOnboardingFlag();
  const form = useForm({
    resolver: zodResolver(collegeFormSchema),
    defaultValues: { collegeId: '', name: '', subdomain: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values) => platformAdminApi.createCollege(values),
    onSuccess: () => {
      toast.success('College created');
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['platform', 'dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['platform', 'colleges'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create college'),
  });

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <div className="flex items-center gap-2">
          <CardTitle>Create New College</CardTitle>
          <Badge variant={newOnboardingEnabled ? 'success' : 'outline'}>
            {newOnboardingEnabled ? 'Institutional Position Accounts: On' : 'Institutional Position Accounts: Off'}
          </Badge>
        </div>
        <CardDescription>
          {newOnboardingEnabled
            ? 'Onboard a new college/organization to the platform. When its Principal invitation is accepted, a Level 1 Institutional Position Account is also provisioned alongside the Principal user.'
            : 'Onboard a new college/organization to the platform.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 overflow-y-auto">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="grid gap-4 sm:grid-cols-3">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Organization Name</FormLabel><FormControl><Input placeholder="Enter college name" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="collegeId" render={({ field }) => (
              <FormItem><FormLabel>College Code</FormLabel><FormControl><Input placeholder="e.g. ABCENG" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="subdomain" render={({ field }) => (
              <FormItem><FormLabel>Subdomain</FormLabel><FormControl><Input placeholder="e.g. abceng" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="sm:col-span-3">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create College'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export function PlatformDashboardPage() {
  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ['platform', 'dashboard-summary'],
    queryFn: () => platformAdminApi.getDashboardSummary(),
  });

  return (
    <PageContainer className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Platform Dashboard"
        description="Onboard new colleges, manage organizations, and monitor platform health."
      />

      <div className="mb-4 grid shrink-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Organizations" value={summary?.organizationsCount} isLoading={isLoading} />
        <StatCard icon={Users} label="Active Users" value={summary?.activeUsersCount} isLoading={isLoading} />
        <StatCard icon={Mail} label="Pending Invitations" value={summary?.pendingInvitationsCount} isLoading={isLoading} />
        <StatCard icon={Clock} label="Trial Colleges" value={summary?.trialCollegesCount} isLoading={isLoading} />
      </div>

      {isError && (
        <Card className="mb-4 shrink-0"><CardContent className="p-5 text-sm text-destructive">Could not load dashboard summary.</CardContent></Card>
      )}

      <div className="min-h-0 flex-1">
        <CreateCollegeCard />
      </div>
    </PageContainer>
  );
}
